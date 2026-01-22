import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import nodemailer from 'nodemailer';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

/* =========================
   MIDDLEWARE
========================= */

// CORRECTION MAJEURE ICI : Configuration CORS permissive pour éviter "Erreur réseau"
app.use(cors({
  origin: true, // Autorise toutes les origines (temporairement pour le debug)
  credentials: true
}));

app.use(express.json());

// Log des requêtes pour debug
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

/* =========================
   MONGODB
========================= */

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB connectée'))
  .catch(err => console.error('❌ MongoDB error:', err));

/* =========================
   MODELS
========================= */

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
  slot: {
    type: String,            // ISO string
    required: true,
    index: true
  },
  nom: String,
  prenom: String,
  email: String,
  tel: String,

  moniteur: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },

  status: {
    type: String,
    enum: ['confirmée', 'annulée'],
    default: 'confirmée'
  },

  createdAt: { type: Date, default: Date.now },
  updatedAt: Date
});

const Reservation = mongoose.model('Reservation', reservationSchema, 'reservations');

/* =========================
   MAILER
========================= */

// Sécurité : ne plante pas si les variables d'env sont manquantes
const transporter = (process.env.MAIL_USER && process.env.MAIL_PASS) 
  ? nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASS
      }
    })
  : null;

/* =========================
   AUTH
========================= */

app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ message: 'Email et mot de passe requis' });

    const user = await User.findOne({ email: email.toLowerCase(), password });
    if (!user)
      return res.status(401).json({ message: 'Identifiants incorrects' });

    res.json({
      email: user.email,
      nom: user.nom,
      prenom: user.prenom,
      role: user.role,
      tel: user.tel
    });
  } catch (error) {
    res.status(500).json({ message: "Erreur serveur lors du login" });
  }
});

/* =========================
   USERS
========================= */

app.get('/users', async (_, res) => {
  try {
    const users = await User.find({});
    res.json(users);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/users', async (req, res) => {
  try {
    const { nom, prenom, email, password, role, tel } = req.body;
    if (!nom || !prenom || !role)
      return res.status(400).json({ message: 'Nom, prénom et rôle requis' });

    if (email) {
      const exists = await User.findOne({ email });
      if (exists)
        return res.status(409).json({ message: 'Email déjà utilisé' });
    }

    const user = new User({ nom, prenom, email, password, role, tel });
    await user.save();

    res.status(201).json({ message: 'Utilisateur créé', user });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.delete('/users/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user)
      return res.status(404).json({ message: 'Utilisateur introuvable' });

    if (user.role === 'moniteur') {
      await Reservation.updateMany(
        { moniteur: user._id },
        { $set: { moniteur: null } }
      );
    }

    await User.deleteOne({ _id: user._id });
    res.json({ message: 'Utilisateur supprimé' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

/* =========================
   SLOTS / PLANNING
========================= */

app.get('/slots', async (_, res) => {
  try {
    const reservations = await Reservation.find({}).populate('moniteur');

    const events = reservations
      .map(r => {
        const start = new Date(r.slot);
        if (isNaN(start.getTime())) return null;

        const end = new Date(start.getTime() + 60 * 60 * 1000); // 1h de durée
        const moniteurNom = r.moniteur
          ? `${r.moniteur.prenom} ${r.moniteur.nom}`
          : 'Non assigné';

        return {
          id: r._id,
          title: `${r.prenom || ''} ${r.nom || ''} - ${moniteurNom}`,
          start: start.toISOString(),
          end: end.toISOString(),
          extendedProps: {
            email: r.email,
            nom: r.nom,
            prenom: r.prenom,
            tel: r.tel,
            moniteur: moniteurNom
          }
        };
      })
      .filter(Boolean);

    res.json(events);
  } catch (e) {
    console.error("Erreur GET /slots", e);
    res.status(500).json({ message: "Erreur lors de la récupération du planning" });
  }
});

/* =========================
   RESERVATIONS
========================= */

app.post('/reservations', async (req, res) => {
  try {
    const { slot, nom, prenom, email, tel, moniteurId } = req.body;

    if (!slot)
      return res.status(400).json({ message: 'Slot requis (ISO)' });

    const dateSlot = new Date(slot);
    if (isNaN(dateSlot.getTime()))
      return res.status(400).json({ message: 'Slot invalide (ISO attendu)' });

    if (moniteurId) {
      const conflict = await Reservation.findOne({
        slot: dateSlot.toISOString(),
        moniteur: moniteurId
      });

      if (conflict)
        return res.status(409).json({
          message: 'Moniteur déjà réservé sur ce créneau'
        });
    }

    const reservation = new Reservation({
      slot: dateSlot.toISOString(),
      nom,
      prenom,
      email,
      tel: tel || '',
      moniteur: moniteurId || null
    });

    await reservation.save();

    if (transporter && email) {
      const formatted = dateSlot.toLocaleString('fr-FR', {
        timeZone: 'Europe/Paris',
        hour12: false
      });

      transporter.sendMail({
        from: `"Green Permis" <${process.env.MAIL_USER}>`,
        to: email,
        subject: "Confirmation de réservation",
        text: `Bonjour ${prenom || ''},\n\nVotre réservation du ${formatted} est confirmée.\n\nGreen Permis`
      }).catch(err => console.error("Erreur envoi mail:", err));
    }

    res.status(201).json({ message: 'Réservation créée', reservation });
  } catch (e) {
    console.error("Erreur POST /reservations", e);
    res.status(500).json({ message: e.message || "Erreur interne" });
  }
});

app.delete('/reservations/:id', async (req, res) => {
  try {
    const reservation = await Reservation.findById(req.params.id).populate('moniteur');
    if (!reservation)
      return res.status(404).json({ message: 'Réservation introuvable' });

    await Reservation.deleteOne({ _id: reservation._id });

    if (transporter && reservation.email) {
      const formatted = new Date(reservation.slot).toLocaleString('fr-FR', {
        timeZone: 'Europe/Paris',
        hour12: false
      });

      transporter.sendMail({
        from: `"Green Permis" <${process.env.MAIL_USER}>`,
        to: reservation.email,
        subject: "Annulation de réservation",
        text: `Votre réservation du ${formatted} a été annulée.`
      }).catch(console.error);
    }

    res.json({ message: 'Réservation annulée' });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

/* =========================
   HEALTH
========================= */

app.get('/', (_, res) => {
  res.json({ message: 'API Green Permis opérationnelle' });
});

app.listen(PORT, () => {
  console.log(`🚗 Serveur démarré sur http://localhost:${PORT}`);
});
