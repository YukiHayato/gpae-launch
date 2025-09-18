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
  status: { type: String, default: 'demande_en_cours' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: Date
});
const Reservation = mongoose.model('Reservation', reservationSchema, 'reservations');

const moniteurSchema = new mongoose.Schema({
  tag: String
});
const Moniteur = mongoose.model('Moniteur', moniteurSchema, 'moniteurs');

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
  const moniteurs = await Moniteur.find({});
  res.json(moniteurs);
});

app.post('/moniteurs', async (req, res) => {
  const { tag } = req.body;
  if (!tag) return res.status(400).json({ message: 'Tag requis' });
  const m = new Moniteur({ tag });
  await m.save();
  res.status(201).json(m);
});

app.delete('/moniteurs/:id', async (req, res) => {
  await Moniteur.deleteOne({ _id: req.params.id });
  res.json({ message: 'Moniteur supprimé' });
});

// -------------------
// Créneaux & Réservations
// -------------------
app.get('/slots', async (req, res) => {
  try {
    const reservations = await Reservation.find({});
    const events = reservations.map(r => {
      const start = new Date(r.slot);
      if (isNaN(start.getTime())) return null;
      const end = new Date(start.getTime() + 60*60*1000);
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
          moniteur: r.moniteur
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
    const { slot, nom, prenom, email, tel, moniteur } = req.body;
    if (!slot || !moniteur) return res.status(400).json({ message: 'Slot et moniteur requis' });

    const dateSlot = new Date(slot);
    if (isNaN(dateSlot.getTime())) return res.status(400).json({ message: 'Slot invalide, format ISO requis' });

    // Vérifie qu’aucun autre élève n’a déjà réservé ce moniteur sur ce créneau
    const existing = await Reservation.findOne({ slot: dateSlot.toISOString(), moniteur });
    if (existing) return res.status(409).json({ message: 'Ce moniteur est déjà réservé sur ce créneau' });

    const newReservation = new Reservation({
      slot: dateSlot.toISOString(),
      nom,
      prenom,
      email,
      tel: tel || '',
      moniteur
    });

    await newReservation.save();

    if (email) {
      const options = { timeZone: 'Europe/Paris', hour12: false };
      const formatted = dateSlot.toLocaleString('fr-FR', options);

      transporter.sendMail({
        from: `"Auto-École Essentiel" <${process.env.MAIL_USER}>`,
        to: email,
        subject: "Confirmation de réservation",
        text: `Bonjour ${prenom},\n\nVotre réservation pour le ${formatted} avec le moniteur ${moniteur} a bien été enregistrée.\n\nMerci,\nAuto-École Essentiel`
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
    const reservation = await Reservation.findById(id);
    if (!reservation) return res.status(404).json({ message: 'Réservation non trouvée' });

    await Reservation.deleteOne({ _id: id });

    if (reservation.email) {
      const options = { timeZone: 'Europe/Paris', hour12: false };
      const formatted = new Date(reservation.slot).toLocaleString('fr-FR', options);

      transporter.sendMail({
        from: `"Auto-École Essentiel" <${process.env.MAIL_USER}>`,
        to: reservation.email,
        subject: "Annulation de réservation",
        text: `Bonjour ${reservation.prenom},\n\nVotre réservation prévue le ${formatted} avec le moniteur ${reservation.moniteur} a été annulée.\n\nMerci,\nAuto-École Essentiel`
      }).catch(console.error);
    }

    res.json({ message: 'Réservation annulée' });
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur', error: err.message });
  }
});

// -------------------
// Envoi mail à tous
// -------------------
app.post('/send-mail-all', async (req, res) => {
  const { subject, message } = req.body;

  if (!subject || !message) return res.status(400).json({ message: "Sujet et message requis" });

  try {
    const users = await User.find({}, "email prenom nom");

    for (let user of users) {
      if (!user.email) continue;

      await transporter.sendMail({
        from: `"Auto-École Essentiel" <${process.env.MAIL_USER}>`,
        to: user.email,
        subject,
        text: `Bonjour ${user.prenom || ""} ${user.nom || ""},\n\n${message}\n\nMerci,\nAuto-École Essentiel`
      });
    }

    res.json({ message: `Mails envoyés à ${users.length} utilisateurs` });
  } catch (err) {
    console.error("Erreur envoi mails:", err);
    res.status(500).json({ message: "Erreur lors de l'envoi des mails", error: err.message });
  }
});

// -------------------
// Test / Health
// -------------------
app.get('/', (req, res) => res.json({ message: 'API GPAE - Planning Auto École' }));

app.listen(PORT, () => console.log(`🚗 Serveur démarré sur http://localhost:${PORT}`));

export default app;
