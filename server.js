import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import nodemailer from 'nodemailer';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// -------------------
// Middleware
// -------------------
app.use(cors({
  origin: (origin, callback) => {
    const allowed = [
      "http://localhost:5173",
      "https://auto-ecole-essentiel.lovable.app",
      "https://greenpermis-autoecole.fr",
      "https://www.greenpermis-autoecole.fr"
    ];
    if (!origin || allowed.includes(origin)) return callback(null, true);
    console.warn("❌ Origin non autorisée:", origin);
    return callback(new Error("CORS non autorisé"));
  },
  credentials: true
}));

app.use(express.json());

// Logs simples
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  console.log('Body:', req.body);
  next();
});

// -------------------
// MongoDB / Models
// -------------------
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB connectée'))
  .catch(err => console.error('❌ Erreur MongoDB:', err));

// 🆕 SCHÉMA MODIFIÉ : Ajout du champ disponibilites pour les moniteurs
const userSchema = new mongoose.Schema({
  nom: String,
  prenom: String,
  email: String,
  password: String,
  role: String,
  tel: String,
  // 👇 NOUVEAU : Planning du moniteur (Map : jour => [heures])
  disponibilites: {
    type: Map,
    of: [String],
    default: new Map()
  }
});
const User = mongoose.model('User', userSchema, 'users');

const reservationSchema = new mongoose.Schema({
  slot: String,
  nom: String,
  prenom: String,
  email: String,
  tel: String,
  moniteur: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  status: { type: String, default: 'demande_en_cours' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: Date
});
const Reservation = mongoose.model('Reservation', reservationSchema, 'reservations');

// 🆕 NOUVEAU SCHÉMA : Logs d'envoi d'emails
const emailLogSchema = new mongoose.Schema({
  sentBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Admin qui a envoyé
  sentByEmail: String, // Email de l'admin
  recipientType: String, // 'single' ou 'all'
  recipientCount: Number,
  recipients: [String], // Liste des emails destinataires
  subject: String,
  message: String,
  isHTML: { type: Boolean, default: false },
  sentAt: { type: Date, default: Date.now },
  status: String // 'success' ou 'error'
});
const EmailLog = mongoose.model('EmailLog', emailLogSchema, 'emaillogs');

// -------------------
// Mailer
// -------------------
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
});

// -------------------
// 🆕 MIDDLEWARE : Vérification admin
// -------------------
const requireAdmin = async (req, res, next) => {
  const { adminEmail } = req.body;
  
  if (!adminEmail) {
    return res.status(401).json({ message: 'Email administrateur requis pour cette action' });
  }

  try {
    const admin = await User.findOne({ email: adminEmail.toLowerCase() });
    
    if (!admin || admin.role !== 'admin') {
      return res.status(403).json({ message: 'Accès refusé : droits administrateur requis' });
    }
    
    // Attacher l'admin à la requête pour utilisation ultérieure
    req.admin = admin;
    next();
  } catch (err) {
    res.status(500).json({ message: 'Erreur de vérification', error: err.message });
  }
};

// -------------------
// 🆕 RATE LIMITING SIMPLE (en mémoire)
// -------------------
const emailRateLimits = new Map(); // email => { count, resetTime }
const RATE_LIMIT = 50; // Max 50 emails par heure par admin
const RATE_WINDOW = 60 * 60 * 1000; // 1 heure en ms

const checkRateLimit = (adminEmail) => {
  const now = Date.now();
  const limit = emailRateLimits.get(adminEmail);
  
  // Pas encore de limite ou fenêtre expirée
  if (!limit || now > limit.resetTime) {
    emailRateLimits.set(adminEmail, { count: 1, resetTime: now + RATE_WINDOW });
    return { allowed: true, remaining: RATE_LIMIT - 1 };
  }
  
  // Incrémenter le compteur
  if (limit.count < RATE_LIMIT) {
    limit.count++;
    return { allowed: true, remaining: RATE_LIMIT - limit.count };
  }
  
  // Limite atteinte
  return { allowed: false, remaining: 0, resetIn: Math.ceil((limit.resetTime - now) / 1000 / 60) };
};

// -------------------
// 🔧 HELPER CORRIGÉ : Extraire jour et heure d'un slot ISO (timezone Paris)
// -------------------
const extraireJourEtHeure = (slotISO) => {
  const date = new Date(slotISO);
  
  // ✅ Convertir en heure locale Paris
  const options = { timeZone: 'Europe/Paris' };
  const parisDate = new Date(date.toLocaleString('en-US', options));
  
  const jourSemaine = parisDate.toLocaleDateString('fr-FR', { weekday: 'long' });
  const heure = `${parisDate.getHours()}h`;
  
  console.log(`🕐 Extraction: ${slotISO} → ${jourSemaine} ${heure}`);
  
  return { jourSemaine, heure };
};

// -------------------
// Auth
// -------------------
app.post('/login', async (req, res) => {
  let { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ message: 'Email et mot de passe requis' });

  email = email.toLowerCase();

  try {
    const user = await User.findOne({ email, password });
    if (!user) return res.status(401).json({ message: 'Email ou mot de passe incorrect' });

    res.json({
      email: user.email,
      nom: user.nom,
      prenom: user.prenom,
      role: user.role,
      tel: user.tel
    });
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur', error: err.message });
  }
});

// -------------------
// Utilisateurs (admin)
// -------------------
app.get('/users', async (req, res) => {
  try {
    const users = await User.find({});
    // Convertir les Maps en objets simples pour le JSON
    const usersFormatted = users.map(u => ({
      ...u.toObject(),
      disponibilites: u.disponibilites ? Object.fromEntries(u.disponibilites) : {}
    }));
    res.json(usersFormatted);
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur', error: err.message });
  }
});

// 🆕 ENDPOINT MODIFIÉ : Création d'utilisateur avec disponibilités
app.post('/users', async (req, res) => {
  try {
    const { nom, prenom, email, password, role, tel, disponibilites } = req.body;
    if (!nom || !prenom || !role) return res.status(400).json({ message: 'Nom, prénom et rôle requis' });

    const existing = email ? await User.findOne({ email }) : null;
    if (existing) return res.status(409).json({ message: 'Email déjà utilisé' });

    // Créer le nouvel utilisateur
    const userData = { 
      nom, 
      prenom, 
      email: email || null, 
      password: password || null, 
      role, 
      tel: tel || null 
    };

    // 👇 Si c'est un moniteur ET qu'on a des disponibilités, les ajouter
    if (role === 'moniteur' && disponibilites) {
      // Convertir l'objet en Map pour MongoDB
      userData.disponibilites = new Map(Object.entries(disponibilites));
    }

    const newUser = new User(userData);
    await newUser.save();

    res.status(201).json({ 
      message: 'Utilisateur ajouté', 
      user: {
        ...newUser.toObject(),
        disponibilites: newUser.disponibilites ? Object.fromEntries(newUser.disponibilites) : {}
      }
    });
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur', error: err.message });
  }
});

// 🆕 NOUVEL ENDPOINT : Modifier les disponibilités d'un moniteur
app.put('/users/:id/disponibilites', async (req, res) => {
  try {
    const { id } = req.params;
    const { disponibilites } = req.body;

    if (!disponibilites) {
      return res.status(400).json({ message: 'Disponibilités requises' });
    }

    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: 'Utilisateur non trouvé' });
    if (user.role !== 'moniteur') {
      return res.status(400).json({ message: 'Cet utilisateur n\'est pas un moniteur' });
    }

    // Mettre à jour les disponibilités
    user.disponibilites = new Map(Object.entries(disponibilites));
    await user.save();

    res.json({ 
      message: 'Disponibilités mises à jour',
      user: {
        ...user.toObject(),
        disponibilites: Object.fromEntries(user.disponibilites)
      }
    });
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur', error: err.message });
  }
});

// 🆕 NOUVEL ENDPOINT : Récupérer les moniteurs disponibles pour un créneau
app.get('/moniteurs/disponibles', async (req, res) => {
  try {
    const { jour, heure } = req.query;

    if (!jour || !heure) {
      return res.status(400).json({ message: 'Jour et heure requis (ex: ?jour=lundi&heure=10h)' });
    }

    // Récupérer tous les moniteurs
    const moniteurs = await User.find({ role: 'moniteur' });

    // Filtrer ceux qui travaillent ce jour-là à cette heure
    const moniteursDisponibles = moniteurs.filter(moniteur => {
      if (!moniteur.disponibilites || moniteur.disponibilites.size === 0) {
        return false; // Pas de planning défini
      }

      const heuresDisponibles = moniteur.disponibilites.get(jour) || [];
      return heuresDisponibles.includes(heure);
    });

    // Formater la réponse
    const response = moniteursDisponibles.map(m => ({
      id: m._id,
      nom: m.nom,
      prenom: m.prenom,
      email: m.email,
      tel: m.tel
    }));

    res.json(response);
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur', error: err.message });
  }
});

app.get('/reservations', async (req, res) => {
  try {
    const { userEmail } = req.query;
    let reservations;

    if (userEmail) {
      reservations = await Reservation.find({ email: userEmail }).populate('moniteur');
    } else {
      reservations = await Reservation.find({}).populate('moniteur');
    }

    const events = reservations.map(r => {
      const start = new Date(r.slot);
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      const moniteurNom = r.moniteur ? `${r.moniteur.prenom} ${r.moniteur.nom}` : "Non assigné";

      if (isNaN(start.getTime())) {
        console.error('⚠️ Slot invalide:', r.slot);
        return null;
      }

      return {
        id: r._id.toString(),
        title: `${r.prenom} ${r.nom} - ${moniteurNom}`,
        start: start.toISOString(),
        end: end.toISOString(),
        status: r.status,
        moniteur: moniteurNom,
        extendedProps: {
          email: r.email,
          tel: r.tel,
          nom: r.nom,
          prenom: r.prenom,
          moniteur: moniteurNom
        }
      };
    }).filter(e => e !== null);

    res.json(events);
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur', error: err.message });
  }
});

// 🆕 ENDPOINT MODIFIÉ : Validation des disponibilités du moniteur
app.post('/reservations', async (req, res) => {
  try {
    const { slot, nom, prenom, email, tel, moniteurId } = req.body;
    if (!slot || !moniteurId) return res.status(400).json({ message: 'Slot et moniteur requis' });

    const dateSlot = new Date(slot);
    if (isNaN(dateSlot.getTime())) return res.status(400).json({ message: 'Slot invalide, format ISO requis' });

    // 👇 NOUVELLE VALIDATION : Vérifier que le moniteur travaille sur ce créneau
    const moniteur = await User.findById(moniteurId);
    if (!moniteur) return res.status(404).json({ message: 'Moniteur non trouvé' });
    if (moniteur.role !== 'moniteur') {
      return res.status(400).json({ message: 'L\'utilisateur sélectionné n\'est pas un moniteur' });
    }

    const { jourSemaine, heure } = extraireJourEtHeure(slot);
    const heuresDisponibles = moniteur.disponibilites?.get(jourSemaine) || [];

    console.log(`🔍 Vérification: ${moniteur.prenom} ${moniteur.nom} - ${jourSemaine} ${heure}`);
    console.log(`📅 Disponibilités du jour:`, heuresDisponibles);

    if (!heuresDisponibles.includes(heure)) {
      return res.status(400).json({ 
        message: `Le moniteur ${moniteur.prenom} ${moniteur.nom} ne travaille pas le ${jourSemaine} à ${heure}` 
      });
    }

    // Vérifie si le moniteur est déjà réservé sur ce créneau
    const existingWithSameMoniteur = await Reservation.findOne({ slot: dateSlot.toISOString(), moniteur: moniteurId });
    if (existingWithSameMoniteur) return res.status(409).json({ message: 'Ce moniteur est déjà réservé sur ce créneau' });

    // Vérifie si l'élève a déjà une réservation avec ce même moniteur
    const existingForUserSameMoniteur = await Reservation.findOne({ slot: dateSlot.toISOString(), email, moniteur: moniteurId });
    if (existingForUserSameMoniteur) return res.status(409).json({ message: 'Vous avez déjà une réservation avec ce moniteur sur ce créneau' });

    const newReservation = new Reservation({
      slot: dateSlot.toISOString(),
      nom,
      prenom,
      email,
      tel: tel || '',
      moniteur: moniteurId
    });
    await newReservation.save();

    // Envoi email
    if (email) {
      const options = { timeZone: 'Europe/Paris', hour12: false };
      const formatted = dateSlot.toLocaleString('fr-FR', options);
      const moniteurNom = `${moniteur.prenom} ${moniteur.nom}`;

      transporter.sendMail({
        from: `"Green Permis Auto-école" <${process.env.MAIL_USER}>`,
        to: email,
        subject: "Confirmation de réservation",
        text: `Bonjour ${prenom},\n\nVotre réservation pour le ${formatted} avec le moniteur ${moniteurNom} a bien été enregistrée.\n\nMerci,\nGreen Permis Auto-école`
      }).catch(console.error);
    }

    res.status(201).json({ message: 'Réservation créée', reservation: newReservation });
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur', error: err.message });
  }
});

app.delete('/reservations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const reservation = await Reservation.findById(id).populate('moniteur');
    if (!reservation) return res.status(404).json({ message: 'Réservation non trouvée' });

    await Reservation.deleteOne({ _id: id });

    if (reservation.email) {
      const options = { timeZone: 'Europe/Paris', hour12: false };
      const formatted = new Date(reservation.slot).toLocaleString('fr-FR', options);
      const moniteurNom = reservation.moniteur ? `${reservation.moniteur.prenom} ${reservation.moniteur.nom}` : "Non assigné";

      transporter.sendMail({
        from: `"Green Permis Auto-école" <${process.env.MAIL_USER}>`,
        to: reservation.email,
        subject: "Annulation de réservation",
        text: `Bonjour ${reservation.prenom},\n\nVotre réservation prévue le ${formatted} avec le moniteur ${moniteurNom} a été annulée.\n\nMerci,\nGreen Permis Auto-école`
      }).catch(console.error);
    }

    res.json({ message: 'Réservation annulée' });
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur', error: err.message });
  }
});

// -------------------
// Admin : Toutes les réservations d'un même créneau
// -------------------
app.get('/admin/reservations/:slot', async (req, res) => {
  try {
    const { slot } = req.params;
    const dateSlot = new Date(slot);
    if (isNaN(dateSlot.getTime())) return res.status(400).json({ message: 'Slot invalide' });

    const reservations = await Reservation.find({ slot: dateSlot.toISOString() }).populate('moniteur');
    const formatted = reservations.map(r => ({
      id: r._id,
      nom: r.nom,
      prenom: r.prenom,
      email: r.email,
      tel: r.tel,
      moniteur: r.moniteur ? { id: r.moniteur._id, nom: r.moniteur.nom, prenom: r.moniteur.prenom } : null,
      status: r.status
    }));

    res.json(formatted);
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur', error: err.message });
  }
});

// 🆕 ENDPOINT MODIFIÉ : Validation pour l'admin aussi
app.post('/admin/reservations', async (req, res) => {
  try {
    const { slot, nom, prenom, email, tel, moniteurId } = req.body;
    if (!slot || !moniteurId) return res.status(400).json({ message: 'Slot et moniteur requis' });

    const dateSlot = new Date(slot);
    if (isNaN(dateSlot.getTime())) return res.status(400).json({ message: 'Slot invalide' });

    // 👇 Validation des disponibilités du moniteur
    const moniteur = await User.findById(moniteurId);
    if (!moniteur || moniteur.role !== 'moniteur') {
      return res.status(400).json({ message: 'Moniteur invalide' });
    }

    const { jourSemaine, heure } = extraireJourEtHeure(slot);
    const heuresDisponibles = moniteur.disponibilites?.get(jourSemaine) || [];

    if (!heuresDisponibles.includes(heure)) {
      return res.status(400).json({ 
        message: `Le moniteur ${moniteur.prenom} ${moniteur.nom} ne travaille pas le ${jourSemaine} à ${heure}` 
      });
    }

    const existingWithSameMoniteur = await Reservation.findOne({ slot: dateSlot.toISOString(), moniteur: moniteurId });
    if (existingWithSameMoniteur) return res.status(409).json({ message: 'Ce moniteur est déjà réservé sur ce créneau' });

    const newReservation = new Reservation({ slot: dateSlot.toISOString(), nom, prenom, email, tel: tel || '', moniteur: moniteurId });
    await newReservation.save();

    res.status(201).json({ message: 'Réservation ajoutée sur le créneau', reservation: newReservation });
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur', error: err.message });
  }
});

// -------------------
// 🆕 ENVOI D'EMAILS ADMIN (AMÉLIORÉ)
// -------------------

// Envoi d'email individuel ou groupé avec vérification admin
app.post('/admin/send-email', requireAdmin, async (req, res) => {
  try {
    const { recipient, subject, message, isHTML } = req.body;
    const admin = req.admin;
    
    if (!subject || !message) {
      return res.status(400).json({ message: "Sujet et message requis" });
    }

    // 🆕 Vérification du rate limit
    const rateCheck = checkRateLimit(admin.email);
    if (!rateCheck.allowed) {
      return res.status(429).json({ 
        message: `Limite d'envoi atteinte. Réessayez dans ${rateCheck.resetIn} minutes.`,
        resetIn: rateCheck.resetIn 
      });
    }

    let recipients = [];
    let recipientType = 'single';

    if (recipient === 'all') {
      // Récupérer tous les élèves
      const students = await User.find({ role: 'eleve' }, "email prenom nom");
      recipients = students.filter(s => s.email);
      recipientType = 'all';
    } else {
      // Un seul destinataire - recipient contient l'EMAIL directement
      const user = await User.findOne({ email: recipient });
      if (!user || !user.email) {
        return res.status(404).json({ message: "Utilisateur non trouvé" });
      }
      recipients = [user];
    }

    if (recipients.length === 0) {
      return res.status(400).json({ message: "Aucun destinataire trouvé" });
    }

    // 🆕 Préparer les options d'email selon le format (HTML ou texte)
    const emailOptions = {
      from: `"Green Permis Auto-école" <${process.env.MAIL_USER}>`,
      subject
    };

    // Envoi des emails
    const emailPromises = recipients.map(user => {
      const personalizedMessage = isHTML 
        ? message.replace(/{{prenom}}/g, user.prenom || "").replace(/{{nom}}/g, user.nom || "")
        : `Bonjour ${user.prenom || ""} ${user.nom || ""},\n\n${message}\n\nCordialement,\nGreen Permis Auto-école`;

      return transporter.sendMail({
        ...emailOptions,
        to: user.email,
        ...(isHTML ? { html: personalizedMessage } : { text: personalizedMessage })
      });
    });

    await Promise.all(emailPromises);

    // 🆕 Logger l'envoi dans la base de données
    const emailLog = new EmailLog({
      sentBy: admin._id,
      sentByEmail: admin.email,
      recipientType,
      recipientCount: recipients.length,
      recipients: recipients.map(r => r.email),
      subject,
      message,
      isHTML: isHTML || false,
      status: 'success'
    });
    await emailLog.save();

    console.log(`📧 ${recipients.length} email(s) envoyé(s) par ${admin.email}`);

    res.json({ 
      message: `Email${recipients.length > 1 ? 's envoyés' : ' envoyé'} avec succès à ${recipients.length} destinataire${recipients.length > 1 ? 's' : ''}`,
      count: recipients.length,
      remaining: rateCheck.remaining
    });
  } catch (err) {
    console.error("❌ Erreur envoi email:", err);
    
    // Logger l'échec
    try {
      const emailLog = new EmailLog({
        sentBy: req.admin._id,
        sentByEmail: req.admin.email,
        recipientType: req.body.recipient === 'all' ? 'all' : 'single',
        recipientCount: 0,
        recipients: [],
        subject: req.body.subject,
        message: req.body.message,
        isHTML: req.body.isHTML || false,
        status: 'error'
      });
      await emailLog.save();
    } catch (logErr) {
      console.error("❌ Erreur lors du logging:", logErr);
    }

    res.status(500).json({ message: "Erreur lors de l'envoi", error: err.message });
  }
});

// 🆕 NOUVEL ENDPOINT : Récupérer l'historique des emails envoyés
app.get('/admin/email-logs', requireAdmin, async (req, res) => {
  try {
    const { limit = 50, page = 1 } = req.query;
    
    const logs = await EmailLog.find({})
      .sort({ sentAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit))
      .populate('sentBy', 'nom prenom email');

    const total = await EmailLog.countDocuments();

    res.json({
      logs,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur', error: err.message });
  }
});

// 🆕 NOUVEL ENDPOINT : Statistiques d'envoi d'emails
app.get('/admin/email-stats', requireAdmin, async (req, res) => {
  try {
    const now = new Date();
    const last24h = new Date(now - 24 * 60 * 60 * 1000);
    const last7d = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const last30d = new Date(now - 30 * 24 * 60 * 60 * 1000);

    const stats = {
      last24h: await EmailLog.countDocuments({ sentAt: { $gte: last24h }, status: 'success' }),
      last7d: await EmailLog.countDocuments({ sentAt: { $gte: last7d }, status: 'success' }),
      last30d: await EmailLog.countDocuments({ sentAt: { $gte: last30d }, status: 'success' }),
      total: await EmailLog.countDocuments({ status: 'success' }),
      failed: await EmailLog.countDocuments({ status: 'error' })
    };

    res.json(stats);
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur', error: err.message });
  }
});

// -------------------
// Test / Health
// -------------------
app.get('/', (req, res) => res.json({ message: 'API GPAE - Planning Auto École (avec système emails admin amélioré)' }));

app.listen(PORT, () => console.log(`🚗 Serveur démarré sur http://localhost:${PORT}`));

export default app;
