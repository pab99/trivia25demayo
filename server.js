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

let jugadores = {}; // { socketId/username: { username, puntos, vidas, respondidas: [], combo } }

io.on('connection', (socket) => {
    console.log('Usuario conectado:', socket.id);

    socket.on('join_game', (username) => {
        const cleanUsername = username.toLowerCase().replace('@', '').trim();
        
        // Si el usuario ya existía de un intento previo, lo reenganchamos o reseteamos su sesión actual
        // pero manteniendo su registro en el objeto global para el leaderboard
        jugadores[cleanUsername] = {
            username: cleanUsername,
            puntos: 0,
            vidas: 3,
            respondidas: [],
            combo: 0,
            socketId: socket.id // Vinculamos su socket actual
        };
        
        // Guardamos también una referencia por socket para saber quién responde
        socket.usernameClean = cleanUsername;
        
        enviarRanking();
    });

    socket.on('get_pregunta', () => {
        const cleanUsername = socket.usernameClean;
        const jugador = jugadores[cleanUsername];
        if (!jugador) return;

        if (jugador.vidas <= 0) {
            socket.emit('game_over', { puntos: jugador.puntos });
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
        const cleanUsername = socket.usernameClean;
        const jugador = jugadores[cleanUsername];
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
        const cleanUsername = socket.usernameClean;
        if (jugadores[cleanUsername]) {
            jugadores[cleanUsername].puntos = 0;
            jugadores[cleanUsername].vidas = 3;
            jugadores[cleanUsername].respondidas = [];
            jugadores[cleanUsername].combo = 0;
            socket.emit('game_resetted');
            enviarRanking();
        }
    });

    socket.on('disconnect', () => {
        console.log('Usuario desconectado:', socket.id);
        // IMPORTANTE: Ya NO eliminamos al jugador de la lista. 
        // Su intento queda guardado de forma permanente para el Leaderboard gigante.
    });
});

function enviarRanking() {
    // Ordenamos de mayor a menor puntaje para la pantalla gigante
    let lista = Object.values(jugadores)
        .sort((a, b) => b.puntos - a.puntos);
    io.emit('update_ranking', lista);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor patrio corriendo en puerto ${PORT}`));
