import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

/* ======================
   MIDDLEWARE
====================== */

app.use(cors({ origin: true }));
app.use(express.json());

app.use((req, _res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

/* ======================
   DB
====================== */

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => {
    console.error("❌ Mongo error", err);
    process.exit(1);
  });

/* ======================
   MODELS
====================== */

const UserSchema = new mongoose.Schema({
  nom: String,
  prenom: String,
  email: String,
  role: {
    type: String,
    enum: ["admin", "eleve", "moniteur"],
    required: true,
  },
});

const ReservationSchema = new mongoose.Schema(
  {
    date: {
      type: String, // YYYY-MM-DD
      required: true,
      index: true,
    },
    block: {
      type: Number, // 1..9
      required: true,
      index: true,
    },

    eleve: {
      nom: String,
      prenom: String,
      email: String,
    },

    moniteur: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

// 1 moniteur max par bloc
ReservationSchema.index(
  { date: 1, block: 1, moniteur: 1 },
  { unique: true, sparse: true }
);

const User = mongoose.model("User", UserSchema);
const Reservation = mongoose.model("Reservation", ReservationSchema);

/* ======================
   HELPERS
====================== */

const isValidDate = d =>
  typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);

const isValidBlock = b =>
  Number.isInteger(b) && b >= 1 && b <= 9;

const badRequest = (res, msg) =>
  res.status(400).json({ message: msg });

/* ======================
   ROUTES
====================== */

/* ---------- HEALTH ---------- */

app.get("/", (_req, res) => {
  res.json({ status: "API OK" });
});

/* ---------- USERS ---------- */

app.post("/login", async (req, res) => {
  const { email } = req.body;
  const user = await User.findOne({ email });
  if (!user) return res.status(401).json({ message: "Utilisateur inconnu" });
  res.json(user);
});

/* ---------- PLANNING ---------- */

app.get("/slots", async (_req, res) => {
  const reservations = await Reservation.find({})
    .populate("moniteur", "nom prenom");

  res.json(
    reservations.map(r => ({
      id: r._id,
      date: r.date,
      block: r.block,
      eleve: r.eleve,
      moniteur: r.moniteur
        ? `${r.moniteur.prenom} ${r.moniteur.nom}`
        : null,
    }))
  );
});

/* ---------- MONITEURS DISPONIBLES ---------- */

app.get("/moniteurs/available", async (req, res) => {
  const { date, block } = req.query;

  if (!isValidDate(date))
    return badRequest(res, "date invalide");

  if (!isValidBlock(Number(block)))
    return badRequest(res, "block invalide");

  const busy = await Reservation.find({
    date,
    block: Number(block),
    moniteur: { $ne: null },
  }).select("moniteur");

  const busyIds = busy.map(r => r.moniteur);

  const available = await User.find({
    role: "moniteur",
    _id: { $nin: busyIds },
  });

  res.json(available);
});

/* ---------- CREER RESERVATION ---------- */

app.post("/reservations", async (req, res) => {
  const { date, block, eleve, moniteurId } = req.body;

  if (!isValidDate(date))
    return badRequest(res, "date invalide");

  if (!isValidBlock(block))
    return badRequest(res, "block invalide");

  if (!eleve?.email)
    return badRequest(res, "élève requis");

  const exists = await Reservation.findOne({
    date,
    block,
    "eleve.email": eleve.email,
  });

  if (exists)
    return res.status(409).json({ message: "Déjà réservé" });

  const reservation = await Reservation.create({
    date,
    block,
    eleve,
    moniteur: moniteurId || null,
  });

  res.status(201).json(reservation);
});

/* ---------- ANNULER ---------- */

app.delete("/reservations/:id", async (req, res) => {
  const r = await Reservation.findById(req.params.id);
  if (!r) return res.status(404).json({ message: "Introuvable" });

  await r.deleteOne();
  res.json({ message: "Réservation supprimée" });
});

/* ======================
   START
====================== */

app.listen(PORT, () => {
  console.log(`🚀 API listening on ${PORT}`);
});
