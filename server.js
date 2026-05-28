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

// 1. Carga de preguntas
let preguntasTodo = [];
try {
    preguntasTodo = JSON.parse(fs.readFileSync(path.join(__dirname, 'preguntas.json'), 'utf8'));
} catch (err) { console.error("Error al leer preguntas.json:", err); }

// 2. Conexión MongoDB
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ Conectado a MongoDB"))
    .catch(err => console.error("❌ Error de conexión a MongoDB:", err));

const Jugador = mongoose.model('Jugador', new mongoose.Schema({
    username: String,
    puntos: Number, // Este es el puntaje máximo histórico
    puntosRondaActual: Number,
    vidas: Number,
    respondidas: Array,
    combo: Number,
    socketId: String,
    hora: String
}, { collection: 'ranking' }));

// 3. Lógica Socket
io.on('connection', (socket) => {
    
    socket.on('join_game', async (username) => {
        socket.usernameClean = username.toLowerCase().replace('@', '').trim();
        let jugador = await Jugador.findOne({ username: socket.usernameClean });
        
        if (!jugador) {
            jugador = new Jugador({ 
                username: socket.usernameClean, 
                puntos: 0, 
                puntosRondaActual: 0, 
                vidas: 3, 
                respondidas: [], 
                combo: 0, 
                socketId: socket.id, 
                hora: new Date().toLocaleTimeString() 
            });
        } else {
            // SOLO reseteamos la ronda, no los puntos históricos
            jugador.vidas = 3;
            jugador.respondidas = [];
            jugador.combo = 0;
            jugador.puntosRondaActual = 0;
            jugador.socketId = socket.id;
        }
        await jugador.save();
    });

    socket.on('get_pregunta', async () => {
        const jugador = await Jugador.findOne({ username: socket.usernameClean });
        if (!jugador) return;

        if (jugador.vidas <= 0 || jugador.respondidas.length >= 10) {
            const todos = await Jugador.find().sort({ puntos: -1 });
            const puesto = todos.findIndex(j => j.username === jugador.username) + 1;
            socket.emit(jugador.vidas <= 0 ? 'game_over' : 'game_completed', { puntos: jugador.puntosRondaActual, puesto });
            return;
        }

        const disponibles = preguntasTodo.filter(p => !jugador.respondidas.includes(p.id));
        if (disponibles.length === 0) return;

        const p = disponibles[Math.floor(Math.random() * disponibles.length)];
        socket.emit('pregunta_data', { 
            id: p.id, 
            pregunta: p.pregunta, 
            opciones: [p.correcta, ...p.incorrectas].sort(() => Math.random() - 0.5), 
            numeroPregunta: jugador.respondidas.length + 1 
        });
    });

    socket.on('enviar_respuesta', async ({ preguntaId, respuesta, intento, tiempoEmpleado }) => {
        const jugador = await Jugador.findOne({ username: socket.usernameClean });
        if (!jugador) return;

        const pregunta = preguntasTodo.find(p => p.id === preguntaId);
        if (respuesta === "__TIEMPO_AGOTADO__") {
            jugador.respondidas.push(preguntaId);
            jugador.vidas -= 1;
            jugador.combo = 0;
            socket.emit('resultado_respuesta', { correcta: false, tiempoAgotado: true, vidas: jugador.vidas });
        } else {
            const esCorrecta = pregunta.correcta === respuesta;
            if (esCorrecta) {
                jugador.respondidas.push(preguntaId);
                jugador.combo += 1;
                jugador.puntosRondaActual += (intento === 1 ? 10 : 5);
                // Si el puntaje actual supera al máximo histórico, actualizamos el histórico
                if (jugador.puntosRondaActual > jugador.puntos) jugador.puntos = jugador.puntosRondaActual;
                socket.emit('resultado_respuesta', { correcta: true, puntos: jugador.puntosRondaActual, combo: jugador.combo });
            } else if (intento === 2) {
                jugador.respondidas.push(preguntaId);
                jugador.vidas -= 1;
                jugador.combo = 0;
                socket.emit('resultado_respuesta', { correcta: false, intento: 2, vidas: jugador.vidas });
            } else {
                socket.emit('resultado_respuesta', { correcta: false, intento: 1 });
            }
        }
        await jugador.save();
    });
});

server.listen(process.env.PORT || 3000);
