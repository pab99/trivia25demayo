const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server); // Esta es la configuración correcta en el servidor

app.use(express.static('public'));

// --- CARGA DE PREGUNTAS ---
let preguntasTodo = [];
try {
    const ruta = path.join(__dirname, 'preguntas.json');
    preguntasTodo = JSON.parse(fs.readFileSync(ruta, 'utf8'));
    console.log("✅ Preguntas cargadas:", preguntasTodo.length);
} catch (err) {
    console.error("❌ ERROR CARGANDO PREGUNTAS:", err.message);
}

// --- MONGODB ---
mongoose.connect(process.env.MONGO_URI);

const Jugador = mongoose.model('Jugador', new mongoose.Schema({
    username: String,
    puntos: Number,
    puntosRondaActual: Number,
    vidas: Number,
    respondidas: Array,
    combo: Number,
    socketId: String,
    hora: String
}, { collection: 'ranking' }));

// --- SOCKETS ---
io.on('connection', (socket) => {
    console.log('Cliente conectado:', socket.id);

    socket.on('join_game', async (username) => {
        socket.usernameClean = username.toLowerCase().replace('@', '').trim();
        let jugador = await Jugador.findOne({ username: socket.usernameClean });
        if (!jugador) {
            jugador = new Jugador({ username: socket.usernameClean, puntos: 0, puntosRondaActual: 0, vidas: 3, respondidas: [], combo: 0, socketId: socket.id, hora: new Date().toLocaleTimeString() });
            await jugador.save();
        }
        io.emit('update_ranking', await Jugador.find().sort({ puntos: -1 }));
    });

    socket.on('get_pregunta', async () => {
        const jugador = await Jugador.findOne({ username: socket.usernameClean });
        if (!jugador || jugador.vidas <= 0) return;
        
        const disponibles = preguntasTodo.filter(p => !jugador.respondidas.includes(p.id));
        if (disponibles.length === 0) return;

        const p = disponibles[Math.floor(Math.random() * disponibles.length)];
        socket.emit('pregunta_data', { id: p.id, pregunta: p.pregunta, opciones: [p.correcta, ...p.incorrectas].sort(() => Math.random() - 0.5), numeroPregunta: jugador.respondidas.length + 1 });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor activo en puerto ${PORT}`));
