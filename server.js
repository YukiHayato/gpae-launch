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
    console.warn("âŒ Origin non autorisÃ©e:", origin);
    return callback(new Error("CORS non autorisÃ©"));
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
  .then(() => console.log('âœ… MongoDB connectÃ©e'))
  .catch(err => console.error('âŒ Erreur MongoDB:', err));

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
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur', error: err.message });
  }
});

app.post('/users', async (req, res) => {
  try {
    const { nom, prenom, email, password, role, tel } = req.body;
    if (!nom || !prenom || !role) return res.status(400).json({ message: 'Nom, prÃ©nom et rÃ´le requis' });

    const existing = email ? await User.findOne({ email }) : null;
    if (existing) return res.status(409).json({ message: 'Email dÃ©jÃ  utilisÃ©' });

    const newUser = new User({ nom, prenom, email: email || null, password: password || null, role, tel: tel || null });
    await newUser.save();

    res.status(201).json({ message: 'Utilisateur ajoutÃ©', user: newUser });
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur', error: err.message });
  }
});

// -------------------
// Supprimer un utilisateur (dÃ©tache moniteur)
app.delete('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: 'Utilisateur non trouvÃ©' });

    // DÃ©tacher le moniteur de toutes ses rÃ©servations
    if (user.role === 'moniteur') {
      await Reservation.updateMany({ moniteur: id }, { $set: { moniteur: null } });
    }

    await User.deleteOne({ _id: id });
    res.json({ message: 'Utilisateur supprimÃ© et rÃ©servations dÃ©tachÃ©es si moniteur' });
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur', error: err.message });
  }
});

// -------------------
// CrÃ©neaux & RÃ©servations
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

app.post('/reservations', async (req, res) => {
  try {
    const { slot, nom, prenom, email, tel, moniteurId } = req.body;
    if (!slot || !moniteurId) return res.status(400).json({ message: 'Slot et moniteur requis' });

    const dateSlot = new Date(slot);
    if (isNaN(dateSlot.getTime())) return res.status(400).json({ message: 'Slot invalide, format ISO requis' });

    // VÃ©rifie si le moniteur est dÃ©jÃ  rÃ©servÃ© sur ce crÃ©neau
    const existingWithSameMoniteur = await Reservation.findOne({ slot: dateSlot.toISOString(), moniteur: moniteurId });
    if (existingWithSameMoniteur) return res.status(409).json({ message: 'Ce moniteur est dÃ©jÃ  rÃ©servÃ© sur ce crÃ©neau' });

    // VÃ©rifie si l'Ã©lÃ¨ve a dÃ©jÃ  une rÃ©servation avec ce mÃªme moniteur
    const existingForUserSameMoniteur = await Reservation.findOne({ slot: dateSlot.toISOString(), email, moniteur: moniteurId });
    if (existingForUserSameMoniteur) return res.status(409).json({ message: 'Vous avez dÃ©jÃ  une rÃ©servation avec ce moniteur sur ce crÃ©neau' });

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

      const moniteur = await User.findById(moniteurId);
      const moniteurNom = moniteur ? `${moniteur.prenom} ${moniteur.nom}` : "Non assignÃ©";

      transporter.sendMail({
        from: `"Green Permis Auto-Ã©cole" <${process.env.MAIL_USER}>`,
        to: email,
        subject: "Confirmation de rÃ©servation",
        text: `Bonjour ${prenom},\n\nVotre rÃ©servation pour le ${formatted} avec le moniteur ${moniteurNom} a bien Ã©tÃ© enregistrÃ©e.\n\nMerci,\nGreen Permis Auto-Ã©cole`
      }).catch(console.error);
    }

    res.status(201).json({ message: 'RÃ©servation crÃ©Ã©e', reservation: newReservation });
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur', error: err.message });
  }
});



app.delete('/reservations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const reservation = await Reservation.findById(id).populate('moniteur');
    if (!reservation) return res.status(404).json({ message: 'RÃ©servation non trouvÃ©e' });

    await Reservation.deleteOne({ _id: id });

    if (reservation.email) {
      const options = { timeZone: 'Europe/Paris', hour12: false };
      const formatted = new Date(reservation.slot).toLocaleString('fr-FR', options);
      const moniteurNom = reservation.moniteur ? `${reservation.moniteur.prenom} ${reservation.moniteur.nom}` : "Non assignÃ©";

      transporter.sendMail({
        from: `"Green Permis Auto-Ã©cole" <${process.env.MAIL_USER}>`,
        to: reservation.email,
        subject: "Annulation de rÃ©servation",
        text: `Bonjour ${reservation.prenom},\n\nVotre rÃ©servation prÃ©vue le ${formatted} avec le moniteur ${moniteurNom} a Ã©tÃ© annulÃ©e.\n\nMerci,\nGreen Permis Auto-Ã©cole`
      }).catch(console.error);
    }

    res.json({ message: 'RÃ©servation annulÃ©e' });
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur', error: err.message });
  }
});

// -------------------
// Admin : Toutes les rÃ©servations d'un mÃªme crÃ©neau
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

// -------------------
// Admin : Ajouter une rÃ©servation sur un crÃ©neau existant
// -------------------
app.post('/admin/reservations', async (req, res) => {
  try {
    const { slot, nom, prenom, email, tel, moniteurId } = req.body;
    if (!slot || !moniteurId) return res.status(400).json({ message: 'Slot et moniteur requis' });

    const dateSlot = new Date(slot);
    if (isNaN(dateSlot.getTime())) return res.status(400).json({ message: 'Slot invalide' });

    const existingWithSameMoniteur = await Reservation.findOne({ slot: dateSlot.toISOString(), moniteur: moniteurId });
    if (existingWithSameMoniteur) return res.status(409).json({ message: 'Ce moniteur est dÃ©jÃ  rÃ©servÃ© sur ce crÃ©neau' });

    const newReservation = new Reservation({ slot: dateSlot.toISOString(), nom, prenom, email, tel: tel || '', moniteur: moniteurId });
    await newReservation.save();

    res.status(201).json({ message: 'RÃ©servation ajoutÃ©e sur le crÃ©neau', reservation: newReservation });
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur', error: err.message });
  }
});

// -------------------
// Envoi mail Ã  tous
// -------------------
app.post('/send-mail-all', async (req, res) => {
  const { subject, message } = req.body;
  if (!subject || !message) return res.status(400).json({ message: "Sujet et message requis" });

  try {
    const users = await User.find({}, "email prenom nom");
    for (let user of users) {
      if (!user.email) continue;
      await transporter.sendMail({
        from: `"Green Permis Auto-Ã©cole" <${process.env.MAIL_USER}>`,
        to: user.email,
        subject,
        text: `Bonjour ${user.prenom || ""} ${user.nom || ""},\n\n${message}\n\nMerci,\nGreen Permis Auto-Ã©cole`
      });
    }
    res.json({ message: `Mails envoyÃ©s Ã  ${users.length} utilisateurs` });
  } catch (err) {
    console.error("Erreur envoi mails:", err);
    res.status(500).json({ message: "Erreur lors de l'envoi des mails", error: err.message });
  }
});

// -------------------
// Test / Health
// -------------------
app.get('/', (req, res) => res.json({ message: 'API GPAE - Planning Auto Ã‰cole' }));

app.listen(PORT, () => console.log(`ðŸš— Serveur dÃ©marrÃ© sur http://localhost:${PORT}`));

export default app;
