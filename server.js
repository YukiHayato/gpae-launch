import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Simulation d'une base de données en mémoire
let reservations = [];
let nextId = 1;

// GET /slots - Récupérer tous les créneaux/réservations
app.get('/slots', (req, res) => {
  try {
    // Convertir les réservations au format FullCalendar
    const events = reservations.map(reservation => ({
      id: reservation.id,
      title: `${reservation.prenom} ${reservation.nom}`,
      start: reservation.slot,
      end: new Date(new Date(reservation.slot).getTime() + 60 * 60 * 1000).toISOString(), // +1h
      status: reservation.status,
      backgroundColor: reservation.status === 'demande_en_cours' ? '#ff9800' : '#f44336',
      borderColor: reservation.status === 'demande_en_cours' ? '#ff9800' : '#f44336',
      extendedProps: {
        status: reservation.status,
        email: reservation.email,
        tel: reservation.tel,
        nom: reservation.nom,
        prenom: reservation.prenom
      }
    }));

    res.json(events);
  } catch (error) {
    res.status(500).json({ message: 'Erreur serveur', error: error.message });
  }
});

// POST /reservations - Créer une nouvelle demande de réservation
app.post('/reservations', (req, res) => {
  try {
    const { slot, nom, prenom, email, tel, status = 'demande_en_cours' } = req.body;

    // Validation des données
    if (!slot || !nom || !prenom || !email || !tel) {
      return res.status(400).json({ message: 'Tous les champs sont requis' });
    }

    // Vérifier si le créneau est déjà pris
    const existingReservation = reservations.find(r => r.slot === slot);
    if (existingReservation) {
      return res.status(409).json({ message: 'Ce créneau est déjà réservé' });
    }

    // Créer la nouvelle réservation
    const newReservation = {
      id: nextId++,
      slot,
      nom,
      prenom,
      email,
      tel,
      status,
      createdAt: new Date().toISOString()
    };

    reservations.push(newReservation);

    res.status(201).json({ 
      message: 'Demande de réservation créée avec succès',
      reservation: newReservation 
    });
  } catch (error) {
    res.status(500).json({ message: 'Erreur serveur', error: error.message });
  }
});

// DELETE /reservations/:id - Annuler une demande de réservation
app.delete('/reservations/:id', (req, res) => {
  try {
    const { id } = req.params;
    const reservationIndex = reservations.findIndex(r => r.id === parseInt(id));

    if (reservationIndex === -1) {
      return res.status(404).json({ message: 'Réservation non trouvée' });
    }

    const reservation = reservations[reservationIndex];

    // Seules les demandes en cours peuvent être annulées par l'élève
    if (reservation.status === 'confirme') {
      return res.status(400).json({ message: 'Impossible d\'annuler une réservation confirmée' });
    }

    reservations.splice(reservationIndex, 1);

    res.json({ message: 'Demande de réservation annulée avec succès' });
  } catch (error) {
    res.status(500).json({ message: 'Erreur serveur', error: error.message });
  }
});

// PUT /reservations/:id/status - Modifier le statut d'une réservation (pour le moniteur)
app.put('/reservations/:id/status', (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['demande_en_cours', 'confirme', 'refuse'].includes(status)) {
      return res.status(400).json({ message: 'Statut invalide' });
    }

    const reservation = reservations.find(r => r.id === parseInt(id));

    if (!reservation) {
      return res.status(404).json({ message: 'Réservation non trouvée' });
    }

    reservation.status = status;
    reservation.updatedAt = new Date().toISOString();

    res.json({ 
      message: `Réservation ${status === 'confirme' ? 'confirmée' : status === 'refuse' ? 'refusée' : 'mise à jour'}`,
      reservation 
    });
  } catch (error) {
    res.status(500).json({ message: 'Erreur serveur', error: error.message });
  }
});

// GET /reservations - Récupérer toutes les réservations (pour l'interface moniteur)
app.get('/reservations', (req, res) => {
  try {
    const { status } = req.query;
    
    let filteredReservations = reservations;
    
    if (status) {
      filteredReservations = reservations.filter(r => r.status === status);
    }

    res.json(filteredReservations);
  } catch (error) {
    res.status(500).json({ message: 'Erreur serveur', error: error.message });
  }
});

// Route de test
app.get('/', (req, res) => {
  res.json({ message: 'API GPAE - Planning Auto École' });
});

app.listen(PORT, () => {
  console.log(`🚗 Serveur API démarré sur http://localhost:${PORT}`);
});

export default app;