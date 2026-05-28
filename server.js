const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// --- CONFIGURACIÓN MONGODB ---
const MONGO_URI = process.env.MONGO_URI; 
mongoose.connect(MONGO_URI);

const JugadorSchema = new mongoose.Schema({
    username: { type: String, unique: true },
    puntos: Number,
    puntosRondaActual: Number,
    vidas: Number,
    respondidas: Array,
    combo: Number,
    socketId: String,
    hora: String
}, { collection: 'ranking' });

const Jugador = mongoose.model('Jugador', JugadorSchema);

// --- LÓGICA DE SOCKETS ---
io.on('connection', (socket) => {
    console.log('Dispositivo conectado:', socket.id);
    enviarRanking();

    socket.on('pedir_ranking_dashboard', async () => {
        enviarRanking();
    });
socket.on('get_pregunta', async () => {
    console.log("DEBUG: Usuario intentando pedir pregunta:", socket.usernameClean);
    const jugador = await Jugador.findOne({ username: socket.usernameClean });
    
    if (!jugador) {
        console.log("DEBUG: Jugador no encontrado en BD. ¿El usuario hizo join_game?");
        return;
    }
    socket.on('join_game', async (username) => {
        const cleanUsername = username.toLowerCase().replace('@', '').trim();
        const horaActual = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });

        let jugador = await Jugador.findOne({ username: cleanUsername });

        if (jugador) {
            jugador.vidas = 3;
            jugador.respondidas = [];
            jugador.combo = 0;
            jugador.puntosRondaActual = 0;
            jugador.socketId = socket.id;
            // Solo actualizamos hora si no existía previamente
            if (!jugador.hora) jugador.hora = horaActual;
            await jugador.save();
        } else {
            jugador = new Jugador({
                username: cleanUsername,
                puntos: 0,
                puntosRondaActual: 0,
                vidas: 3,
                respondidas: [],
                combo: 0,
                socketId: socket.id,
                hora: horaActual
            });
            await jugador.save();
        }
        
        socket.usernameClean = cleanUsername;
        enviarRanking();
    });

    socket.on('get_pregunta', async () => {
        const jugador = await Jugador.findOne({ username: socket.usernameClean });
        if (!jugador) return;

        // Lógica de juego igual a la original
        if (jugador.vidas <= 0 || jugador.respondidas.length >= 10) {
            socket.emit(jugador.vidas <= 0 ? 'game_over' : 'game_completed', { 
                puntos: jugador.puntosRondaActual 
            });
            return;
        }

        // Nota: Asegúrate de tener las preguntas cargadas en memoria como antes
        const fs = require('fs');
        const preguntasTodo = JSON.parse(fs.readFileSync('preguntas.json', 'utf8'));
        const disponibles = preguntasTodo.filter(p => !jugador.respondidas.includes(p.id));
        
        if (disponibles.length === 0) return;

        const pregunta = disponibles[Math.floor(Math.random() * disponibles.length)];
        const opciones = [pregunta.correcta, ...pregunta.incorrectas].sort(() => Math.random() - 0.5);

        socket.emit('pregunta_data', {
            id: pregunta.id,
            pregunta: pregunta.pregunta,
            opciones: opciones,
            numeroPregunta: jugador.respondidas.length + 1
        });
    });

    socket.on('enviar_respuesta', async ({ preguntaId, respuesta, intento, tiempoEmpleado }) => {
        const jugador = await Jugador.findOne({ username: socket.usernameClean });
        if (!jugador) return;

        const fs = require('fs');
        const preguntasTodo = JSON.parse(fs.readFileSync('preguntas.json', 'utf8'));
        const pregunta = preguntasTodo.find(p => p.id === preguntaId);

        if (respuesta === "__TIEMPO_AGOTADO__") {
            jugador.respondidas.push(preguntaId);
            jugador.vidas -= 1;
            jugador.combo = 0;
            await jugador.save();
            socket.emit('resultado_respuesta', { correcta: false, tiempoAgotado: true, vidas: jugador.vidas });
        } else {
            const esCorrecta = pregunta.correcta === respuesta;
            if (esCorrecta) {
                jugador.respondidas.push(preguntaId);
                jugador.combo += 1;
                // Lógica de puntos original
                let puntosPregunta = (intento === 1 ? 10 : 5) + Math.max(0, Math.round(15 * Math.log(20 / (tiempoEmpleado + 1))));
                let mult = (jugador.combo >= 12 ? 10 : (jugador.combo >= 9 ? 6 : (jugador.combo >= 6 ? 4 : (jugador.combo === 3 ? 2 : 1))));
                jugador.puntosRondaActual += puntosPregunta * mult;
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
            await jugador.save();
        }
        enviarRanking();
    });
});

async function enviarRanking() {
    const lista = await Jugador.find().sort({ puntos: -1 });
    io.emit('update_ranking', lista);
    io.emit('data_ranking_dashboard', lista);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor MongoDB activo en puerto ${PORT}`));
