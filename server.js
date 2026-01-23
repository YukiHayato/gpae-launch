import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";
import nodemailer from "nodemailer";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

/* =========================
   MIDDLEWARE
========================= */

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

/* =========================
   MONGODB
========================= */

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connectée"))
  .catch(err => {
    console.error("❌ MongoDB error:", err);
    process.exit(1);
  });

/* =========================
   MODELS
========================= */

const userSchema = new mongoose.Schema({
  nom: String,
  prenom: String,
  email: String,
  password: String,
  role: { type: String, enum: ["admin", "eleve", "moniteur"], required: true },
  tel: String,
});

const User = mongoose.model("User", userSchema, "users");

const reservationSchema = new mongoose.Schema(
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

    nom: String,
    prenom: String,
    email: String,
    tel: String,

    moniteur: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    status: {
      type: String,
      enum: ["confirmee", "annulee"],
      default: "confirmee",
    },
  },
  { timestamps: true }
);

// Contrainte logique : 1 moniteur / bloc / jour
reservationSchema.index(
  { date: 1, block: 1, moniteur: 1 },
  { unique: true, sparse: true }
);

const Reservation = mongoose.model(
  "Reservation",
  reservationSchema,
  "reservations"
);

/* =========================
   MAILER (OPTIONNEL)
========================= */

const transporter =
  process.env.MAIL_USER && process.env.MAIL_PASS
    ? nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: process.env.MAIL_USER,
          pass: process.env.MAIL_PASS,
        },
      })
    : null;

/* =========================
   AUTH
========================= */

app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password)
    return res.status(400).json({ message: "Email et mot de passe requis" });

  const user = await User.findOne({ email, password });
  if (!user)
    return res.status(401).json({ message: "Identifiants incorrects" });

  res.json(user);
});

/* =========================
   USERS
========================= */

app.get("/users", async (_req, res) => {
  res.json(await User.find({}));
});

app.post("/users", async (req, res) => {
  const { nom, prenom, email, password, role, tel } = req.body;

  if (!nom || !prenom || !role)
    return res
      .status(400)
      .json({ message: "Nom, prénom et rôle requis" });

  if (email && (await User.findOne({ email })))
    return res.status(409).json({ message: "Email déjà utilisé" });

  const user = new User({ nom, prenom, email, password, role, tel });
  await user.save();

  res.status(201).json(user);
});

app.delete("/users/:id", async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ message: "Introuvable" });

  if (user.role === "moniteur") {
    await Reservation.updateMany(
      { moniteur: user._id },
      { $set: { moniteur: null } }
    );
  }

  await user.deleteOne();
  res.json({ message: "Utilisateur supprimé" });
});

/* =========================
   SLOTS / PLANNING
========================= */

app.get("/slots", async (_req, res) => {
  const reservations = await Reservation.find({})
    .populate("moniteur", "nom prenom");

  const events = reservations.map(r => ({
    id: r._id,
    date: r.date,
    block: r.block,
    extendedProps: {
      email: r.email,
      nom: r.nom,
      prenom: r.prenom,
      moniteur: r.moniteur
        ? `${r.moniteur.prenom} ${r.moniteur.nom}`
        : null,
    },
  }));

  res.json(events);
});

/* =========================
   MONITEURS DISPONIBLES
========================= */

app.get("/moniteurs/available", async (req, res) => {
  const { date, block } = req.query;

  if (!date || !block)
    return res
      .status(400)
      .json({ message: "date et block requis" });

  const busy = await Reservation.find({
    date,
    block: Number(block),
    moniteur: { $ne: null },
  }).select("moniteur");

  const busyIds = busy.map(r => r.moniteur.toString());

  const available = await User.find({
    role: "moniteur",
    _id: { $nin: busyIds },
  });

  res.json(available);
});

/* =========================
   RESERVATIONS
========================= */

app.post("/reservations", async (req, res) => {
  const { date, block, nom, prenom, email, tel, moniteurId } = req.body;

  if (!date || !block)
    return res
      .status(400)
      .json({ message: "date et block requis" });

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    return res.status(400).json({ message: "date invalide" });

  if (block < 1 || block > 9)
    return res.status(400).json({ message: "block invalide" });

  const reservation = new Reservation({
    date,
    block,
    nom,
    prenom,
    email,
    tel,
    moniteur: moniteurId || null,
  });

  await reservation.save();

  if (transporter && email) {
    transporter.sendMail({
      from: `"Green Permis" <${process.env.MAIL_USER}>`,
      to: email,
      subject: "Confirmation de réservation",
      text: `Bonjour ${prenom || ""}, votre réservation du ${date} (bloc ${block}) est confirmée.`,
    }).catch(console.error);
  }

  res.status(201).json(reservation);
});

app.delete("/reservations/:id", async (req, res) => {
  const reservation = await Reservation.findById(req.params.id);
  if (!reservation)
    return res.status(404).json({ message: "Introuvable" });

  await reservation.deleteOne();
  res.json({ message: "Réservation annulée" });
});

/* =========================
   HEALTH
========================= */

app.get("/", (_req, res) => {
  res.json({ message: "API Green Permis opérationnelle (blocs)" });
});

app.listen(PORT, () => {
  console.log(`🚗 Serveur démarré sur http://localhost:${PORT}`);
});


export default app;
