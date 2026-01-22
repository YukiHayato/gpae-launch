import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import nodemailer from 'nodemailer';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// CORS : Autorise tout pour le moment pour éliminer les problèmes réseaux
app.use(cors({ origin: true, credentials: true }));

app.use(express.json());

// LOG DE TOUTES LES REQUETES POUR DEBUG
app.use((req, res, next) => {
  console.log(`[${req.method}] ${req.url}`);
  if (req.method === 'POST') {
    console.log("Body reçu:", JSON.stringify(req.body, null, 2));
  }
  next();
});

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB connectée'))
  .catch(err => console.error('❌ MongoDB error:', err));

/* MODÈLES */
const Reservation = mongoose.model('Reservation', new mongoose.Schema({
  slot: { type: String, required: true }, // On stocke la string brute pour éviter les conversions auto
  nom: String, prenom: String, email: String, tel: String,
  moniteur: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  status: { type: String, default: 'confirmée' }
}, { timestamps: true }), 'reservations');

const User = mongoose.model('User', new mongoose.Schema({
  nom: String, prenom: String, email: String, role: String, tel: String
}), 'users');

/* MAILER */
const transporter = (process.env.MAIL_USER && process.env.MAIL_PASS) 
  ? nodemailer.createTransport({
      service: "gmail",
      auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS }
    })
  : null;

/* ROUTES */

app.get('/slots', async (req, res) => {
  try {
    const reservations = await Reservation.find({}).populate('moniteur');
    const events = reservations.map(r => ({
      id: r._id,
      title: `${r.prenom} ${r.nom}`,
      start: r.slot, // Renvoie la chaîne brute
      end: r.slot,   // Pour simplifier (FullCalendar gère bien si start=end)
      extendedProps: { email: r.email, nom: r.nom, prenom: r.prenom, moniteur: r.moniteur?.nom }
    }));
    res.json(events);
  } catch (e) {
    console.error("Erreur GET /slots:", e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/reservations', async (req, res) => {
  try {
    const { slot, nom, prenom, email } = req.body;

    // VALIDATION ROBUSTE DE LA DATE
    if (!slot) return res.status(400).json({ message: "Le champ 'slot' est manquant" });
    
    // On vérifie juste si c'est une date valide, sans la transformer
    const dateCheck = new Date(slot);
    if (isNaN(dateCheck.getTime())) {
        console.error("❌ Date invalide reçue:", slot);
        return res.status(400).json({ message: `Format de date invalide: ${slot}` });
    }

    const reservation = new Reservation({ slot, nom, prenom, email });
    await reservation.save();

    console.log("✅ Réservation créée pour:", slot);

    if (transporter && email) {
      transporter.sendMail({
        from: `"Green Permis" <${process.env.MAIL_USER}>`,
        to: email,
        subject: "Confirmation",
        text: `RDV confirmé le ${dateCheck.toLocaleString('fr-FR')}`
      }).catch(e => console.error("Mail error:", e));
    }

    res.status(201).json(reservation);
  } catch (e) {
    console.error("❌ Erreur POST /reservations:", e);
    res.status(500).json({ message: e.message });
  }
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

app.get('/', (req, res) => res.send("API OK"));

app.listen(PORT, () => console.log(`🚀 Serveur port ${PORT}`));
