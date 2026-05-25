const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const PREGUNTAS_PATH = path.join(__dirname, 'preguntas.json');
const RANKING_PATH = path.join(__dirname, 'ranking_persistente.json');

const preguntasTodo = JSON.parse(fs.readFileSync(PREGUNTAS_PATH, 'utf8'));

let jugadores = {}; 

if (fs.existsSync(RANKING_PATH)) {
    try {
        jugadores = JSON.parse(fs.readFileSync(RANKING_PATH, 'utf8'));
        console.log('📦 Base de datos local recuperada. Usuarios:', Object.keys(jugadores).length);
    } catch (err) {
        console.log('⚠️ Error al leer ranking persistente:', err.message);
        jugadores = {};
    }
}

function guardarRankingEnDisco() {
    try {
        fs.writeFileSync(RANKING_PATH, JSON.stringify(jugadores, null, 2), 'utf8');
    } catch (err) {
        console.log('❌ Error al escribir en disco:', err.message);
    }
}

io.on('connection', (socket) => {
    console.log('Dispositivo conectado:', socket.id);

    let listaAlConectar = Object.values(jugadores).sort((a, b) => b.puntos - a.puntos);
    socket.emit('update_ranking', listaAlConectar);

    // MANTENER RÉCORD: Al reenganchar, limpiamos la partida actual pero PRESERVAMOS los puntos en la TV
    socket.on('join_game', (username) => {
        const cleanUsername = username.toLowerCase().replace('@', '').trim();
        
        if (jugadores[cleanUsername]) {
            console.log(`🔄 Revancha para @${cleanUsername} - Conservando récord de ${jugadores[cleanUsername].puntos} pts`);
            jugadores[cleanUsername].vidas = 3;
            jugadores[cleanUsername].respondidas = [];
            jugadores[cleanUsername].combo = 0;
            // Guardamos una variable temporal para la ronda actual del celular
            jugadores[cleanUsername].puntosRondaActual = 0; 
            jugadores[cleanUsername].socketId = socket.id;
        } else {
            jugadores[cleanUsername] = {
                username: cleanUsername,
                puntos: 0, // Este será siempre el RÉCORD MÁXIMO histórico para la TV
                puntosRondaActual: 0, // Puntos de la partida que está jugando ahora
                vidas: 3,
                respondidas: [],
                combo: 0,
                socketId: socket.id
            };
        }
        
        socket.usernameClean = cleanUsername;
        guardarRankingEnDisco(); 
        enviarRanking();
    });

    socket.on('get_pregunta', () => {
        const cleanUsername = socket.usernameClean;
        const jugador = jugadores[cleanUsername];
        if (!jugador) return;

        // Si es revancha y todavía no se definió puntosRondaActual, lo inicializamos
        if (jugador.puntosRondaActual === undefined) jugador.puntosRondaActual = 0;

        if (jugador.vidas <= 0) {
            const puesto = obtenerPuesto(cleanUsername);
            socket.emit('game_over', { puntos: jugador.puntosRondaActual, puesto: puesto });
            return;
        }

        if (jugador.respondidas.length >= 10) {
            const puesto = obtenerPuesto(cleanUsername);
            socket.emit('game_completed', { puntos: jugador.puntosRondaActual, puesto: puesto });
            return;
        }

        const disponibles = preguntasTodo.filter(p => !jugador.respondidas.includes(p.id));
        if (disponibles.length === 0) {
            const puesto = obtenerPuesto(cleanUsername);
            socket.emit('game_completed', { puntos: jugador.puntosRondaActual, puesto: puesto });
            return;
        }

        const pregunta = disponibles[Math.floor(Math.random() * disponibles.length)];
        const opciones = [pregunta.correcta, ...pregunta.incorrectas].sort(() => Math.random() - 0.5);

        socket.emit('pregunta_data', {
            id: pregunta.id,
            pregunta: pregunta.pregunta,
            opciones: opciones,
            numeroPregunta: jugador.respondidas.length + 1
        });
    });

    socket.on('enviar_respuesta
