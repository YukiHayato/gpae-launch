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
      const heuresDuJour = moniteur.disponibilites.get(jour) || [];
      return heuresDuJour.includes(heure);
    });

    // Formater la réponse
    const formatted = moniteursDisponibles.map(m => ({
      _id: m._id,
      nom: m.nom,
      prenom: m.prenom,
      email: m.email
    }));

    res.json(formatted);
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur', error: err.message });
  }
});

// -------------------
// Supprimer un utilisateur (détache moniteur)
app.delete('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: 'Utilisateur non trouvé' });

    // Détacher le moniteur de toutes ses réservations
    if (user.role === 'moniteur') {
      await Reservation.updateMany({ moniteur: id }, { $set: { moniteur: null } });
    }

    await User.deleteOne({ _id: id });
    res.json({ message: 'Utilisateur supprimé et réservations détachées si moniteur' });
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur', error: err.message });
  }
});

// -------------------
// Créneaux & Réservations
// -------------------
app.get('/slots', async (req, res) => {
  try {
    const reservations = await Reservation.find({}).populate('moniteur');
    const events = reservations.map(r => {
      const moniteurNom = r.moniteur ? `${r.moniteur.prenom} ${r.moniteur.nom}` : "";
      const start = new Date(r.slot);
      if (isNaN(start.getTime())) return null;
      const end = new Date(start.getTime() + 60*60*1000);

      return {
        id: r._id,
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
// Envoi mail à tous
// -------------------


// 🚀 VERSION AMÉLIORÉE de l'endpoint /send-email
// Remplacez l'ancien endpoint (lignes 470-514) par celui-ci dans votre server.js

app.post('/send-email', async (req, res) => {
  try {
    const { recipient, subject, message } = req.body;
    
    if (!subject || !message) {
      return res.status(400).json({ message: "Sujet et message requis" });
    }

    let recipients = [];

    if (recipient === 'all') {
      // Récupérer tous les élèves
      const students = await User.find({ role: 'eleve' }, "email prenom nom");
      recipients = students.filter(s => s.email);
    } else {
      // Un seul destinataire
      const user = await User.findOne({ email: recipient });
      if (!user || !user.email) {
        return res.status(404).json({ message: "Utilisateur non trouvé" });
      }
      recipients = [user];
    }

    if (recipients.length === 0) {
      return res.status(400).json({ message: "Aucun destinataire trouvé" });
    }

    // ✅ AMÉLIORATION : Répondre IMMÉDIATEMENT (pas de timeout)
    res.json({ 
      message: `Envoi en cours vers ${recipients.length} destinataire${recipients.length > 1 ? 's' : ''}...`,
      count: recipients.length
    });

    // ✅ AMÉLIORATION : Envoi en parallèle en arrière-plan
    sendEmailsInBackground(recipients, subject, message);

  } catch (err) {
    console.error("Erreur envoi email:", err);
    res.status(500).json({ message: "Erreur lors de l'envoi", error: err.message });
  }
});

// 🔧 Fonction pour envoyer les emails en arrière-plan
async function sendEmailsInBackground(recipients, subject, message) {
  console.log(`📧 Début envoi de ${recipients.length} emails...`);
  
  // Envoyer par lots de 5 emails en parallèle (pour ne pas surcharger Gmail)
  const batchSize = 5;
  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < recipients.length; i += batchSize) {
    const batch = recipients.slice(i, i + batchSize);
    
    // Envoyer le batch en parallèle
    const results = await Promise.allSettled(
      batch.map(user => 
        transporter.sendMail({
          from: `"Green Permis Auto-école" <${process.env.MAIL_USER}>`,
          to: user.email,
          subject,
          text: `Bonjour ${user.prenom || ""} ${user.nom || ""},\n\n${message}\n\nCordialement,\nGreen Permis Auto-école`
        })
      )
    );

    // Compter les succès et erreurs
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        successCount++;
        console.log(`✅ Email envoyé à ${batch[index].email}`);
      } else {
        errorCount++;
        console.error(`❌ Erreur pour ${batch[index].email}:`, result.reason.message);
      }
    });

    // Petit délai entre les batches pour ne pas spammer Gmail
    if (i + batchSize < recipients.length) {
      await new Promise(resolve => setTimeout(resolve, 1000)); // 1 seconde de pause
    }
  }

  console.log(`📧 Envoi terminé: ${successCount} succès, ${errorCount} erreurs`);
}



// -------------------
// Test / Health
// -------------------
app.get('/', (req, res) => res.json({ message: 'API GPAE - Planning Auto École (avec gestion planning moniteurs - TIMEZONE FIXED)' }));

app.listen(PORT, () => console.log(`🚗 Serveur démarré sur http://localhost:${PORT}`));

export default app;
