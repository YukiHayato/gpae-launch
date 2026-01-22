import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// ───────────────────────────────────
// Mongo
// ───────────────────────────────────
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ Mongo connecté"))
  .catch(err => {
    console.error("❌ Mongo error", err);
    process.exit(1);
  });

// ───────────────────────────────────
// Models
// ───────────────────────────────────
const userSchema = new mongoose.Schema({
  nom: { type: String, required: true },
  prenom: { type: String, required: true },
  role: {
    type: String,
    enum: ["admin", "moniteur", "eleve"],
    required: true,
  },
  availability: {
    monday: { start: String, end: String },
    tuesday: { start: String, end: String },
    wednesday: { start: String, end: String },
    thursday: { start: String, end: String },
    friday: { start: String, end: String },
    saturday: { start: String, end: String },
  },
});

const reservationSchema = new mongoose.Schema({
  slot: { type: String, required: true }, // ISOString
  moniteurId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  eleve: {
    nom: String,
    prenom: String,
    email: String,
    tel: String,
  },
  status: { type: String, default: "confirmed" },
});

const User = mongoose.model("User", userSchema);
const Reservation = mongoose.model("Reservation", reservationSchema);

// ───────────────────────────────────
// Utils
// ───────────────────────────────────
const getDayKey = date =>
  [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ][date.getDay()];

const isInRange = (time, start, end) =>
  time >= start && time < end;

// ───────────────────────────────────
// API
// ───────────────────────────────────

/**
 * Disponibilité des moniteurs
 */
app.get("/moniteurs/available", async (req, res) => {
  const { date, time } = req.query;
  if (!date || !time)
    return res.status(400).json({ message: "date et time requis" });

  const slotDate = new Date(`${date}T${time}:00`);
  if (isNaN(slotDate))
    return res.status(400).json({ message: "Date invalide" });

  const dayKey = getDayKey(slotDate);

  const moniteurs = await User.find({ role: "moniteur" });

  const reservations = await Reservation.find({
    slot: slotDate.toISOString(),
  });

  const busyMoniteurs = reservations.map(r =>
    r.moniteurId.toString()
  );

  const available = moniteurs.filter(m => {
    const dispo = m.availability?.[dayKey];
    if (!dispo) return false;
    if (!isInRange(time, dispo.start, dispo.end)) return false;
    if (busyMoniteurs.includes(m._id.toString())) return false;
    return true;
  });

  res.json(
    available.map(m => ({
      _id: m._id,
      nom: m.nom,
      prenom: m.prenom,
    }))
  );
});

/**
 * Création réservation
 */
app.post("/reservations", async (req, res) => {
  const { slot, moniteurId, nom, prenom, email, tel } = req.body;
  if (!slot || !moniteurId)
    return res.status(400).json({ message: "slot et moniteurId requis" });

  const slotDate = new Date(slot);
  if (isNaN(slotDate))
    return res.status(400).json({ message: "slot invalide" });

  const exists = await Reservation.findOne({
    slot,
    moniteurId,
  });

  if (exists)
    return res
      .status(409)
      .json({ message: "Moniteur déjà réservé sur ce créneau" });

  const reservation = await Reservation.create({
    slot,
    moniteurId,
    eleve: { nom, prenom, email, tel },
  });

  res.status(201).json(reservation);
});

/**
 * Planning global
 */
app.get("/slots", async (req, res) => {
  const reservations = await Reservation.find().populate(
    "moniteurId",
    "nom prenom"
  );

  const events = reservations.map(r => {
    const start = new Date(r.slot);
    const end = new Date(start.getTime() + 60 * 60 * 1000);

    return {
      start: start.toISOString(),
      end: end.toISOString(),
      title: `${r.eleve.prenom} ${r.eleve.nom}`,
      extendedProps: {
        moniteurNom: `${r.moniteurId.prenom} ${r.moniteurId.nom}`,
      },
    };
  });

  res.json(events);
});

// ───────────────────────────────────
// Health
// ───────────────────────────────────
app.get("/", (_, res) =>
  res.json({ status: "OK", service: "Planning API" })
);

app.listen(process.env.PORT || 3000, () =>
  console.log("🚀 Server ready")
);
