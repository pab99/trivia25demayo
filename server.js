const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const preguntas = JSON.parse(fs.readFileSync(path.join(__dirname, 'preguntas.json'), 'utf8'));

let jugadores = {}; // { socketId: { username, puntos, vidas, respondidas: [], combo } }

io.on('connection', (socket) => {
    console.log('Usuario conectado:', socket.id);

    socket.on('join_game', (username) => {
        jugadores[socket.id] = {
            username: username.toLowerCase().replace('@', '').trim(),
            puntos: 0,
            vidas: 3,
            respondidas: [],
            combo: 0
        };
        enviarRanking();
    });

    socket.on('get_pregunta', () => {
        const jugador = jugadores[socket.id];
        if (!jugador) return;

        if (jugador.vidas <= 0) {
            socket.emit('game_over', { puntos: jugador.puntos });
            return;
        }

        if (jugador.respondidas.length >= 12) {
            socket.emit('game_completed', { puntos: jugador.puntos });
            return;
        }

        const disponibles = preguntas.filter(p => !jugador.respondidas.includes(p.id));
        if (disponibles.length === 0) {
            socket.emit('game_completed', { puntos: jugador.puntos });
            return;
        }

        const pregunta = disponibles[Math.floor(Math.random() * disponibles.length)];
        const opciones = [pregunta.correcta, ...pregunta.incorrectas].sort(() => Math.random() - 0.5);

        socket.emit('pregunta_data', {
            id: pregunta.id,
            pregunta: pregunta.pregunta,
            opciones: opciones
        });
    });

    socket.on('enviar_respuesta', ({ preguntaId, respuesta, intento, tiempoEmpleado }) => {
        const jugador = jugadores[socket.id];
        if (!jugador) return;

        const pregunta = preguntas.find(p => p.id === preguntaId);
        const esCorrecta = pregunta.correcta === respuesta;

        if (esCorrecta) {
            jugador.respondidas.push(preguntaId);
            jugador.combo += 1;

            let puntosBase = intento === 1 ? 10 : 5;
            let bonusTiempo = Math.max(0, Math.round(15 * Math.log(20 / (tiempoEmpleado + 1))));
            let puntosPregunta = puntosBase + bonusTiempo;

            let multiplicador = 1;
            if (jugador.combo === 3) multiplicador = 2;
            if (jugador.combo === 6) multiplicador = 4;
            if (jugador.combo === 9) multiplicador = 6;
            if (jugador.combo === 12) multiplicador = 10;

            jugador.puntos += puntosPregunta * multiplicador;

            socket.emit('resultado_respuesta', { correcta: true, puntos: jugador.puntos, combo: jugador.combo });
        } else {
            if (intento === 1) {
                socket.emit('resultado_respuesta', { correcta: false, intento: 1 });
            } else {
                jugador.respondidas.push(preguntaId);
                jugador.vidas -= 1;
                jugador.combo = 0;
                socket.emit('resultado_respuesta', { correcta: false, intento: 2, vidas: jugador.vidas });
            }
        }
        enviarRanking();
    });

    socket.on('reset_game', () => {
        if (jugadores[socket.id]) {
            jugadores[socket.id].puntos = 0;
            jugadores[socket.id].vidas = 3;
            jugadores[socket.id].respondidas = [];
            jugadores[socket.id].combo = 0;
            socket.emit('game_resetted');
            enviarRanking();
        }
    });

    socket.on('disconnect', () => {
        delete jugadores[socket.id];
        enviarRanking();
    });
});

function enviarRanking() {
    let lista = Object.values(jugadores)
        .sort((a, b) => b.puntos - a.puntos);
    io.emit('update_ranking', lista);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor patrio corriendo en puerto ${PORT}`));
