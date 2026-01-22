import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import nodemailer from 'nodemailer';

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

// Modification du CORS pour autoriser plus d'origines (notamment Lovable/Netlify)
app.use(cors({
  origin: (origin, callback) => {
    // Autorise tout en développement, sinon restreint aux domaines listés
    if (!origin || origin.includes("localhost") || origin.includes("lovable") || origin.includes("greenpermis")) {
      return callback(null, true);
    }
    callback(new Error("CORS non autorisé"));
  },
  credentials: true
}));

app.use(express.json());

/* =========================
   MONGODB & MODELS
========================= */
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB connectée'))
  .catch(err => console.error('❌ MongoDB error:', err));

const User = mongoose.model('User', new mongoose.Schema({
  nom: String, prenom: String, email: String, password: { type: String, select: false }, role: String, tel: String
}), 'users');

const Reservation = mongoose.model('Reservation', new mongoose.Schema({
  slot: { type: String, required: true, index: true },
  nom: String, prenom: String, email: String, tel: String,
  moniteur: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  status: { type: String, enum: ['confirmée', 'annulée'], default: 'confirmée' }
}, { timestamps: true }), 'reservations');

/* =========================
   MAILER (Configuré pour éviter les crashs si variables absentes)
========================= */
const transporter = (process.env.MAIL_USER && process.env.MAIL_PASS) ? nodemailer.createTransport({
  service: "gmail",
  auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS }
}) : null;

/* =========================
   ROUTES
========================= */
app.get('/slots', async (req, res) => {
  try {
    const reservations = await Reservation.find({}).populate('moniteur');
    const events = reservations.map(r => ({
      id: r._id,
      title: `${r.prenom || ''} ${r.nom || ''}`,
      start: r.slot,
      end: new Date(new Date(r.slot).getTime() + 3600000).toISOString(),
      extendedProps: { email: r.email, nom: r.nom, prenom: r.prenom, moniteur: r.moniteur?.nom }
    }));
    res.json(events);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/reservations', async (req, res) => {
  try {
    const { slot, nom, prenom, email, tel, moniteurId } = req.body;
    const reservation = new Reservation({ slot, nom, prenom, email, tel, moniteur: moniteurId });
    await reservation.save();

    if (transporter && email) {
      transporter.sendMail({
        from: `"Green Permis" <${process.env.MAIL_USER}>`,
        to: email,
        subject: "Confirmation Réservation",
        text: `Bonjour ${prenom}, votre RDV du ${new Date(slot).toLocaleString('fr-FR')} est confirmé.`
      }).catch(e => console.error("Mail error:", e));
    }
    res.status(201).json(reservation);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/reservations/:id', async (req, res) => {
  try {
    await Reservation.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/users', async (req, res) => {
  const users = await User.find({});
  res.json(users);
});

app.get('/', (req, res) => res.send("API Online"));

app.listen(PORT, () => console.log(`🚗 Serveur sur port ${PORT}`));
