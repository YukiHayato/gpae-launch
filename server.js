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
  origin: [
    "http://localhost:5173",
    "https://auto-ecole-essentiel.lovable.app",
    "https://greenpermis-autoecole.fr"
  ],
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

const userSchema = new mongoose.Schema({
  nom: String,
  prenom: String,
  email: String,
  password: String,
  role: String,
  tel: String
});
const User = mongoose.model('User', userSchema, 'users');

const reservationSchema = new mongoose.Schema({
  slot: String,
  nom: String,
  prenom: String,
  email: String,
  tel: String,
  moniteur: String, // tag du moniteur choisi
  moniteurId: String, // ID du moniteur pour référence
  status: { type: String, default: 'demande_en_cours' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: Date
});
const Reservation = mongoose.model('Reservation', reservationSchema, 'reservations');

const moniteurSchema = new mongoose.Schema({
  nom: String,      // Nom complet du moniteur
  tag: String,      // Tag court (M1, M2, etc.)
  actif: { type: Boolean, default: true }
});
const Moniteur = mongoose.model('Moniteur', moniteurSchema, 'moniteurs');

// -------------------
// Mailer
// -------------------
const transporter = nodemailer.createTransporter({
  service: "gmail",
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
});

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
// Utilisateurs (admin seulement)
// -------------------
app.get('/users', async (req, res) => {
  try {
    const users = await User.find({});
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur', error: err.message });
  }
});

app.post('/users', async (req, res) => {
  try {
    const { nom, prenom, email, password, role } = req.body;
    if (!nom || !prenom || !email || !password || !role) {
      return res.status(400).json({ message: 'Tous les champs sont requis' });
    }

    const existing = await User.findOne({ email });
    if (existing) return res.status(409).json({ message: 'Email déjà utilisé' });

    const newUser = new User({ nom, prenom, email, password, role });
    await newUser.save();

    res.status(201).json({ message: 'Utilisateur ajouté', user: newUser });
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur', error: err.message });
  }
});

// -------------------
// Moniteurs (admin)
// -------------------
app.get('/moniteurs', async (req, res) => {
  try {
    const moniteurs = await Moniteur.find({});
    res.json(moniteurs);
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur', error: err.message });
  }
});

app.post('/moniteurs', async (req, res) => {
  try {
    const { nom, tag } = req.body;
    if (!nom || !tag) {
      return res.status(400).json({ message: 'Nom et tag requis' });
    }

    // Vérifier que le tag n'existe pas déjà
    const existing = await Moniteur.findOne({ tag });
    if (existing) {
      return res.status(409).json({ message: 'Ce tag existe déjà' });
    }

    const newMoniteur = new Moniteur({ nom, tag });
    await newMoniteur.save();
    
    res.status(201).json(newMoniteur);
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur', error: err.message });
  }
});

app.delete('/moniteurs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Vérifier si le moniteur a des réservations actives
    const activeReservations = await Reservation.countDocuments({ moniteurId: id });
    if (activeReservations > 0) {
      return res.status(400).json({ 
        message: `Impossible de supprimer ce moniteur. Il a ${activeReservations} réservation(s) active(s).` 
      });
    }

    const deletedMoniteur = await Moniteur.findByIdAndDelete(id);
    if (!deletedMoniteur) {
      return res.status(404).json({ message: 'Moniteur non trouvé' });
    }

    res.json({ message: 'Moniteur supprimé', moniteur: deletedMoniteur });
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur', error: err.message });
  }
});

// -------------------
// Créneaux & Réservations
// -------------------
app.get('/slots', async (req, res) => {
  try {
    const reservations = await Reservation.find({});
    const moniteurs = await Moniteur.find({});
    
    const events = reservations.map(r => {
      const start = new Date(r.slot);
      if (isNaN(start.getTime())) return null;
      const end = new Date(start.getTime() + 60*60*1000);
      
      // Trouver le nom complet du moniteur
      const moniteurDoc = moniteurs.find(m => 
        m._id.toString() === r.moniteurId || m.tag === r.moniteur
      );
      const moniteurNom = moniteurDoc ? 
        `${moniteurDoc.nom} (${moniteurDoc.tag})` : 
        r.moniteur || 'Moniteur non spécifié';
      
      return {
        id: r._id,
        title: `${r.prenom} ${r.nom}`,
        start: start.toISOString(),
        end: end.toISOString(),
        status: r.status,
        moniteur: r.moniteur,
        extendedProps: {
          email: r.email,
          tel: r.tel,
          nom: r.nom,
          prenom: r.prenom,
          moniteur: r.moniteur,
          moniteurId: r.moniteurId,
          moniteurNom: moniteurNom
        }
      };
    }).filter(e => e !== null);
    
    res.json(events);
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur', error: err.message });
  }
});

app.post('/reservations', async (req, res) => {
  try {
    const { slot, nom, prenom, email, tel, moniteur, moniteurId } = req.body;
    
    // Validation des champs requis
    if (!slot) {
      return res.status(400).json({ message: 'Slot requis' });
    }
    if (!moniteur && !moniteurId) {
      return res.status(400).json({ message: 'Moniteur requis (tag ou ID)' });
    }
    if (!email) {
      return res.status(400).json({ message: 'Email requis' });
    }

    const dateSlot = new Date(slot);
    if (isNaN(dateSlot.getTime())) {
      return res.status(400).json({ message: 'Slot invalide, format ISO requis' });
    }

    // Vérification 1: Ce moniteur est-il déjà réservé sur ce créneau ?
    const existingForMoniteur = await Reservation.findOne({ 
      slot: dateSlot.toISOString(), 
      $or: [
        { moniteur: moniteur },
        { moniteurId: moniteurId }
      ]
    });

    if (existingForMoniteur) {
      return res.status(409).json({ 
        message: 'Ce moniteur est déjà réservé sur ce créneau' 
      });
    }

    // Vérification 2: Cet élève a-t-il déjà une réservation sur ce créneau ?
    const existingForUser = await Reservation.findOne({ 
      slot: dateSlot.toISOString(), 
      email 
    });

    if (existingForUser) {
      return res.status(409).json({ 
        message: 'Vous avez déjà une réservation sur ce créneau' 
      });
    }

    // Récupérer les informations du moniteur
    let moniteurTag = moniteur;
    let finalMoniteurId = moniteurId;

    if (moniteurId) {
      const moniteurDoc = await Moniteur.findById(moniteurId);
      if (!moniteurDoc) {
        return res.status(404).json({ message: 'Moniteur non trouvé' });
      }
      moniteurTag = moniteurDoc.tag;
      finalMoniteurId = moniteurDoc._id;
    } else if (moniteur) {
      const moniteurDoc = await Moniteur.findOne({ tag: moniteur });
      if (moniteurDoc) {
        finalMoniteurId = moniteurDoc._id;
      }
    }

    // Créer la réservation
    const newReservation = new Reservation({
      slot: dateSlot.toISOString(),
      nom: nom || '',
      prenom: prenom || '',
      email,
      tel: tel || '',
      moniteur: moniteurTag,
      moniteurId: finalMoniteurId
    });

    await newReservation.save();

    // Envoyer l'email de confirmation
    if (email) {
      const options = { timeZone: 'Europe/Paris', hour12: false };
      const formatted = dateSlot.toLocaleString('fr-FR', options);

      const moniteurInfo = moniteurTag ? ` avec le moniteur ${moniteurTag}` : '';

      transporter.sendMail({
        from: `"Auto-École Essentiel" <${process.env.MAIL_USER}>`,
        to: email,
        subject: "Confirmation de réservation",
        text: `Bonjour ${prenom || 'cher élève'},\n\nVotre réservation pour le ${formatted}${moniteurInfo} a bien été enregistrée.\n\nMerci,\nAuto-École Essentiel`
      }).catch(err => {
        console.error('Erreur envoi email:', err);
      });
    }

    res.status(201).json({ 
      message: 'Réservation créée', 
      reservation: newReservation 
    });

  } catch (err) {
    console.error('Erreur lors de la création de réservation:', err);
    res.status(500).json({ message: 'Erreur serveur', error: err.message });
  }
});

app.delete('/reservations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const reservation = await Reservation.findById(id);
    
    if (!reservation) {
      return res.status(404).json({ message: 'Réservation non trouvée' });
    }

    await Reservation.deleteOne({ _id: id });

    // Envoyer l'email d'annulation
    if (reservation.email) {
      const options = { timeZone: 'Europe/Paris', hour12: false };
      const formatted = new Date(reservation.slot).toLocaleString('fr-FR', options);

      const moniteurInfo = reservation.moniteur ? 
        ` avec le moniteur ${reservation.moniteur}` : '';

      transporter.sendMail({
        from: `"Auto-École Essentiel" <${process.env.MAIL_USER}>`,
        to: reservation.email,
        subject: "Annulation de réservation",
        text: `Bonjour ${reservation.prenom || 'cher élève'},\n\nVotre réservation prévue le ${formatted}${moniteurInfo} a été annulée.\n\nMerci,\nAuto-École Essentiel`
      }).catch(err => {
        console.error('Erreur envoi email:', err);
      });
    }

    res.json({ message: 'Réservation annulée', reservation });

  } catch (err) {
    console.error('Erreur lors de l\'annulation:', err);
    res.status(500).json({ message: 'Erreur serveur', error: err.message });
  }
});

// -------------------
// Envoi mail à tous
// -------------------
app.post('/send-mail-all', async (req, res) => {
  const { subject, message } = req.body;

  if (!subject || !message) {
    return res.status(400).json({ message: "Sujet et message requis" });
  }

  try {
    const users = await User.find({}, "email prenom nom");
    let emailsSent = 0;
    let emailsFailed = 0;

    for (let user of users) {
      if (!user.email) continue;

      try {
        await transporter.sendMail({
          from: `"Auto-École Essentiel" <${process.env.MAIL_USER}>`,
          to: user.email,
          subject,
          text: `Bonjour ${user.prenom || ""} ${user.nom || ""},\n\n${message}\n\nMerci,\nAuto-École Essentiel`
        });
        emailsSent++;
      } catch (emailError) {
        console.error(`Erreur envoi email à ${user.email}:`, emailError);
        emailsFailed++;
      }
    }

    res.json({ 
      message: `Mails envoyés: ${emailsSent} succès, ${emailsFailed} échecs`,
      sent: emailsSent,
      failed: emailsFailed
    });

  } catch (err) {
    console.error("Erreur envoi mails:", err);
    res.status(500).json({ 
      message: "Erreur lors de l'envoi des mails", 
      error: err.message 
    });
  }
});

// -------------------
// Statistiques (bonus pour admin)
// -------------------
app.get('/stats', async (req, res) => {
  try {
    const totalUsers = await User.countDocuments({});
    const totalReservations = await Reservation.countDocuments({});
    const totalMoniteurs = await Moniteur.countDocuments({ actif: true });
    
    // Réservations par moniteur
    const reservationsByMoniteur = await Reservation.aggregate([
      {
        $group: {
          _id: "$moniteur",
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ]);

    // Réservations par jour de la semaine
    const reservationsByDay = await Reservation.aggregate([
      {
        $addFields: {
          dayOfWeek: { $dayOfWeek: { $dateFromString: { dateString: "$slot" } } }
        }
      },
      {
        $group: {
          _id: "$dayOfWeek",
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    res.json({
      totalUsers,
      totalReservations,
      totalMoniteurs,
      reservationsByMoniteur,
      reservationsByDay
    });

  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur', error: err.message });
  }
});

// -------------------
// Test / Health
// -------------------
app.get('/', (req, res) => {
  res.json({ 
    message: 'API GPAE - Planning Auto École avec gestion des moniteurs',
    version: '2.0.0',
    endpoints: {
      auth: '/login',
      users: '/users',
      moniteurs: '/moniteurs',
      slots: '/slots',
      reservations: '/reservations',
      stats: '/stats'
    }
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

// Gestion des erreurs 404
app.use('*', (req, res) => {
  res.status(404).json({ message: 'Endpoint non trouvé' });
});

// Gestion des erreurs globales
app.use((err, req, res, next) => {
  console.error('Erreur globale:', err);
  res.status(500).json({ 
    message: 'Erreur interne du serveur',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

app.listen(PORT, () => {
  console.log(`🚗 Serveur démarré sur http://localhost:${PORT}`);
  console.log(`🌍 Environnement: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📧 Mail configuré: ${process.env.MAIL_USER ? 'Oui' : 'Non'}`);
});

export default app;
