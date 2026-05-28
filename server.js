const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// --- CARGA DE PREGUNTAS (EN MEMORIA DESDE EL PRINCIPIO) ---
let preguntasTodo = [];
try {
    const ruta = path.join(__dirname, 'preguntas.json');
    preguntasTodo = JSON.parse(fs.readFileSync(ruta, 'utf8'));
    console.log("✅ Preguntas cargadas correctamente en memoria.");
} catch (err) {
    console.error("❌ ERROR CRÍTICO AL CARGAR PREGUNTAS:", err);
}

// --- CONFIGURACIÓN MONGODB ---
const MONGO_URI = process.env.MONGO_URI; 
mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ Conectado a MongoDB"))
    .catch(err => console.error("❌ Error de conexión MongoDB:", err));

const Jugador = mongoose.model('Jugador', new mongoose.Schema({
    username: { type: String, unique: true },
    puntos: Number,
    puntosRondaActual: Number,
    vidas: Number,
    respondidas: Array,
    combo: Number,
    socketId: String,
    hora: String
}, { collection: 'ranking' }));

// ... (El resto de tu código queda IGUAL, pero cuando necesites las preguntas, usa la variable 'preguntasTodo' global)
