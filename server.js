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

const userSchema = new mongoose.Schema({
  nom: String,
  prenom: String,
  email: String,
  password: String,
  role: String,
  tel: String,
  availability: {
    monday: { start: String, end: String },
    tuesday: { start: String, end: String },
    wednesday: { start: String, end: String },
    thursday: { start: String, end: String },
    friday: { start: String, end: String },
    saturday: { start: String, end: String },
    sunday: { start: String, end: String }
  }
});
const User = mongoose.model('User', userSchema, 'users');

const reservationSchema = new mongoose.Schema({
  slot: String,
  nom: String,
  prenom: String,
  email: String,
  tel: String,
  moniteurId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  moniteur: String,
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
// Helper: Vérifier si un moniteur est disponible à une heure donnée
// -------------------
const isMoniteurAvailableAtTime = (moniteur, date, timeStr) => {
  if (!moniteur.availability) return false;

  const dayOfWeek = date.getDay(); // 0 = dimanche, 1 = lundi, etc.
  const daysMap = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayName = daysMap[dayOfWeek];

  const daySchedule = moniteur.availability[dayName];
  if (!daySchedule || !daySchedule.start || !daySchedule.end) return false;

  const [hour, minute] = timeStr.replace('h', '').split(':').map(Number);
  const timeInMinutes = hour * 60 + (minute || 0);

  const [startHour, startMinute] = daySchedule.start.split(':').map(Number);
  const startInMinutes = startHour * 60 + startMinute;

  const [endHour, endMinute] = daySchedule.end.split(':').map(Number);
  const endInMinutes = endHour * 60 + endMinute;

  return timeInMinutes >= startInMinutes && timeInMinutes < endInMinutes;
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
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur', error: err.message });
  }
});

app.post('/users', async (req, res) => {
  try {
    const { nom, prenom, email, password, role, tel, availability } = req.body;
    if (!nom || !prenom || !role) return res.status(400).json({ message: 'Nom, prénom et rôle requis' });

    const existing = email ? await User.findOne({ email }) : null;
    if (existing) return res.status(409).json({ message: 'Email déjà utilisé' });

    const newUser = new User({
      nom,
      prenom,
      email: email || null,
      password: password || null,
      role,
      tel: tel || null,
      availability: availability || null
    });
    await newUser.save();

    res.status(201).json({ message: 'Utilisateur ajouté', user: newUser });
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur', error: err.message });
  }
});

app.put('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { nom, prenom, tel, availability } = req.body;

    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: 'Utilisateur non trouvé' });

    if (nom) user.nom = nom;
    if (prenom) user.prenom = prenom;
    if (tel !== undefined) user.tel = tel;
    if (availability) user.availability = availability;

    await user.save();
    res.json({ message: 'Utilisateur mis à jour', user });
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur', error: err.message });
  }
});

// -------------------
// Supprimer un utilisateur
// -------------------
app.delete('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: 'Utilisateur non trouvé' });

    // Détacher le moniteur de toutes ses réservations
    if (user.role === 'moniteur') {
      await Reservation.updateMany({ moniteurId: id }, { $set: { moniteurId: null, moniteur: 'Non assigné' } });
    }

    await User.deleteOne({ _id: id });
    res.json({ message: 'Utilisateur supprimé et réservations détachées si moniteur' });
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur', error: err.message });
  }
});

// -------------------
// Moniteurs : Disponibilité
// -------------------
app.get('/moniteurs/available', async (req, res) => {
  try {
    const { date, time } = req.query;
    
    if (!date || !time) {
      return res.status(400).json({ message: 'date et time requis (format: YYYY-MM-DD et HH:mm ou HH)' });
    }

    const slotDate = new Date(date);
    if (isNaN(slotDate.getTime())) {
      return res.status(400).json({ message: 'Date invalide' });
    }

    // Récupérer tous les moniteurs
    const moniteurs = await User.find({ role: 'moniteur' });

    // Filtrer les moniteurs disponibles à cette heure
    const available = moniteurs.filter(m => isMoniteurAvailableAtTime(m, slotDate, time));

    // Récupérer les réservations existantes pour ce créneau
    const slotISO = new Date(`${date}T${time.padEnd(5, '0')}:00`).toISOString();
    const existingReservations = await Reservation.find({ slot: slotISO });
    const bookedMoniteurIds = existingReservations.map(r => r.moniteurId?.toString());

    // Filtrer les moniteurs non réservés
    const availableAndNotBooked = available.filter(m => !bookedMoniteurIds.includes(m._id.toString()));

    res.json(availableAndNotBooked);
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur', error: err.message });
  }
});

// -------------------
// Créneaux & Réservations
// -------------------
app.get('/slots', async (req, res) => {
  try {
    const reservations = await Reservation.find({}).populate('moniteurId');
    const events = reservations.map(r => {
      const moniteurNom = r.moniteur || 'Non assigné';
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
    
    if (!slot || !moniteurId) {
      return res.status(400).json({ message: 'Slot et moniteurId requis' });
    }

    const dateSlot = new Date(slot);
    if (isNaN(dateSlot.getTime())) {
      return res.status(400).json({ message: 'Slot invalide, format ISO requis' });
    }

    // Vérifier que le moniteur existe
    const moniteur = await User.findById(moniteurId);
    if (!moniteur) {
      return res.status(404).json({ message: 'Moniteur non trouvé' });
    }

    // Vérifier la disponibilité du moniteur à cette heure
    const timeStr = dateSlot.toISOString().substring(11, 16); // HH:mm
    const dateStr = dateSlot.toISOString().substring(0, 10); // YYYY-MM-DD
    const isoDate = new Date(dateStr);

    if (!isMoniteurAvailableAtTime(moniteur, isoDate, timeStr)) {
      return res.status(409).json({ message: 'Ce moniteur ne travaille pas à cette heure' });
    }

    // Vérifier si le moniteur est déjà réservé sur ce créneau
    const existingReservation = await Reservation.findOne({
      slot: dateSlot.toISOString(),
      moniteurId: moniteurId
    });
    if (existingReservation) {
      return res.status(409).json({ message: 'Ce moniteur est déjà réservé sur ce créneau' });
    }

    // Vérifier si l'élève a déjà une réservation sur ce créneau (avec n'importe quel moniteur)
    const existingUserReservation = await Reservation.findOne({
      slot: dateSlot.toISOString(),
      email: email
    });
    if (existingUserReservation) {
      return res.status(409).json({ message: 'Vous avez déjà une réservation sur ce créneau' });
    }

    const moniteurName = `${moniteur.prenom} ${moniteur.nom}`.trim();

    const newReservation = new Reservation({
      slot: dateSlot.toISOString(),
      nom,
      prenom,
      email,
      tel: tel || '',
      moniteurId: moniteurId,
      moniteur: moniteurName
    });
    await newReservation.save();

    // Envoi email
    if (email) {
      const options = { timeZone: 'Europe/Paris', hour12: false };
      const formatted = dateSlot.toLocaleString('fr-FR', options);

      transporter.sendMail({
        from: `"Green Permis Auto-école" <${process.env.MAIL_USER}>`,
        to: email,
        subject: "Confirmation de réservation",
        text: `Bonjour ${prenom},\n\nVotre réservation pour le ${formatted} avec le moniteur ${moniteurName} a bien été enregistrée.\n\nMerci,\nGreen Permis Auto-école`
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
    const reservation = await Reservation.findById(id).populate('moniteurId');
    if (!reservation) return res.status(404).json({ message: 'Réservation non trouvée' });

    await Reservation.deleteOne({ _id: id });

    if (reservation.email) {
      const options = { timeZone: 'Europe/Paris', hour12: false };
      const formatted = new Date(reservation.slot).toLocaleString('fr-FR', options);
      const moniteurNom = reservation.moniteur || 'Non assigné';

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

    const reservations = await Reservation.find({ slot: dateSlot.toISOString() }).populate('moniteurId');
    const formatted = reservations.map(r => ({
      id: r._id,
      nom: r.nom,
      prenom: r.prenom,
      email: r.email,
      tel: r.tel,
      moniteur: r.moniteur,
      status: r.status
    }));

    res.json(formatted);
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur', error: err.message });
  }
});

// -------------------
// Admin : Ajouter une réservation sur un créneau existant
// -------------------
app.post('/admin/reservations', async (req, res) => {
  try {
    const { slot, nom, prenom, email, tel, moniteurId } = req.body;
    if (!slot || !moniteurId) return res.status(400).json({ message: 'Slot et moniteurId requis' });

    const dateSlot = new Date(slot);
    if (isNaN(dateSlot.getTime())) return res.status(400).json({ message: 'Slot invalide' });

    // Vérifier que le moniteur existe
    const moniteur = await User.findById(moniteurId);
    if (!moniteur) return res.status(404).json({ message: 'Moniteur non trouvé' });

    // Vérifier la disponibilité du moniteur
    const timeStr = dateSlot.toISOString().substring(11, 16);
    const dateStr = dateSlot.toISOString().substring(0, 10);
    const isoDate = new Date(dateStr);

    if (!isMoniteurAvailableAtTime(moniteur, isoDate, timeStr)) {
      return res.status(409).json({ message: 'Ce moniteur ne travaille pas à cette heure' });
    }

    const existingWithSameMoniteur = await Reservation.findOne({
      slot: dateSlot.toISOString(),
      moniteurId: moniteurId
    });
    if (existingWithSameMoniteur) return res.status(409).json({ message: 'Ce moniteur est déjà réservé sur ce créneau' });

    const moniteurName = `${moniteur.prenom} ${moniteur.nom}`.trim();

    const newReservation = new Reservation({
      slot: dateSlot.toISOString(),
      nom,
      prenom,
      email,
      tel: tel || '',
      moniteurId: moniteurId,
      moniteur: moniteurName
    });
    await newReservation.save();

    res.status(201).json({ message: 'Réservation ajoutée sur le créneau', reservation: newReservation });
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
        from: `"Green Permis Auto-école" <${process.env.MAIL_USER}>`,
        to: user.email,
        subject,
        text: `Bonjour ${user.prenom || ""} ${user.nom || ""},\n\n${message}\n\nMerci,\nGreen Permis Auto-école`
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
