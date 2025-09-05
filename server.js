import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import nodemailer from 'nodemailer';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: [
    "http://localhost:5173", 
    "https://auto-ecole-essentiel.lovable.app"
  ],
  credentials: true
}));

app.use(express.json());

// Logs des requêtes
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  console.log('Body:', req.body);
  next();
});

// -------------------
// Mongoose / Models
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
// Routes Auth
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
// Routes Reservations
// -------------------
app.get('/slots', async (req, res) => {
  try {
    const reservations = await Reservation.find({});
    const events = reservations.map(r => {
      const start = new Date(r.slot);
      if (isNaN(start.getTime())) {
        console.warn(`Créneau invalide pour reservation id: ${r._id} slot: ${r.slot}`);
        return null;
      }
      const end = new Date(start.getTime() + 60*60*1000); // +1h
      return {
        id: r._id,
        title: `${r.prenom} ${r.nom}`,
        start: start.toISOString(),
        end: end.toISOString(),
        status: r.status,
        backgroundColor: r.status === 'demande_en_cours' ? '#ff9800' : '#f44336',
        borderColor: r.status === 'demande_en_cours' ? '#ff9800' : '#f44336',
        extendedProps: {
          status: r.status,
          email: r.email,
          tel: r.tel,
          nom: r.nom,
          prenom: r.prenom
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
    const { slot, nom, prenom, email, tel, status } = req.body;

    if (!slot) return res.status(400).json({ message: 'Slot requis' });

    const dateSlot = new Date(slot);
    if (isNaN(dateSlot.getTime())) {
      return res.status(400).json({ message: 'Slot invalide, format ISO requis' });
    }

    const existing = await Reservation.findOne({ slot: dateSlot.toISOString() });
    if (existing) return res.status(409).json({ message: 'Ce créneau est déjà réservé' });

    const newReservation = new Reservation({
      slot: dateSlot.toISOString(),
      nom,
      prenom,
      email,
      tel: tel || '',
      status: status || 'demande_en_cours'
    });

    await newReservation.save();

    // --- Envoi mail confirmation ---
    if (email) {
      await transporter.sendMail({
        from: `"Auto-École Essentiel" <${process.env.MAIL_USER}>`,
        to: email,
        subject: "Confirmation de réservation",
        text: `Bonjour ${prenom},\n\nVotre réservation pour le ${dateSlot.toLocaleString()} a bien été enregistrée.\n\nMerci,\nAuto-École Essentiel`
      });
    }

    res.status(201).json({ message: 'Demande de réservation créée avec succès', reservation: newReservation });

  } catch (err) {
    console.error("Erreur réservation:", err);
    res.status(500).json({ message: 'Erreur serveur', error: err.message });
  }
});

app.delete('/reservations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const reservation = await Reservation.findById(id);
    if (!reservation) return res.status(404).json({ message: 'Réservation non trouvée' });

    if (reservation.status === 'confirme') {
      return res.status(400).json({ message: 'Impossible d\'annuler une réservation confirmée' });
    }

    await Reservation.deleteOne({ _id: id });

    // --- Envoi mail annulation ---
    if (reservation.email) {
      await transporter.sendMail({
        from: `"Auto-École Essentiel" <${process.env.MAIL_USER}>`,
        to: reservation.email,
        subject: "Annulation de réservation",
        text: `Bonjour ${reservation.prenom},\n\nVotre réservation prévue le ${new Date(reservation.slot).toLocaleString()} a été annulée.\n\nMerci,\nAuto-École Essentiel`
      });
    }

    res.json({ message: 'Demande de réservation annulée avec succès' });
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur', error: err.message });
  }
});

app.put('/reservations/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['demande_en_cours', 'confirme', 'refuse'].includes(status)) {
      return res.status(400).json({ message: 'Statut invalide' });
    }

    const reservation = await Reservation.findById(id);
    if (!reservation) return res.status(404).json({ message: 'Réservation non trouvée' });

    reservation.status = status;
    reservation.updatedAt = new Date();
    await reservation.save();

    res.json({ message: `Réservation ${status}`, reservation });
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur', error: err.message });
  }
});

// -------------------
// Test / Health
// -------------------
app.get('/', (req, res) => res.json({ message: 'API GPAE - Planning Auto École' }));

app.listen(PORT, () => console.log(`🚗 Serveur API démarré sur http://localhost:${PORT}`));

export default app;
