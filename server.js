        const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const preguntasTodo = JSON.parse(fs.readFileSync(path.join(__dirname, 'preguntas.json'), 'utf8'));

let jugadores = {}; // { username: { username, puntos, vidas, respondidas: [], combo } }

io.on('connection', (socket) => {
    console.log('Usuario conectado:', socket.id);

    socket.on('join_game', (username) => {
        const cleanUsername = username.toLowerCase().replace('@', '').trim();
        
        jugadores[cleanUsername] = {
            username: cleanUsername,
            puntos: 0,
            vidas: 3,
            respondidas: [], // IDs de preguntas hechas en ESTA ronda
            combo: 0,
            socketId: socket.id
        };
        
        socket.usernameClean = cleanUsername;
        enviarRanking();
    });

    socket.on('get_pregunta', () => {
        const cleanUsername = socket.usernameClean;
        const jugador = jugadores[cleanUsername];
        if (!jugador) return;

        // Condición 1: Se quedó sin vidas
        if (jugador.vidas <= 0) {
            const puesto = obtenerPuesto(cleanUsername);
            socket.emit('game_over', { puntos: jugador.puntos, puesto: puesto });
            return;
        }

        // Condición 2: Ya respondió las 10 preguntas fijadas de su ronda
        if (jugador.respondidas.length >= 10) {
            const puesto = obtenerPuesto(cleanUsername);
            socket.emit('game_completed', { puntos: jugador.puntos, puesto: puesto });
            return;
        }

        // Buscar preguntas que NO haya respondido en este intento actual
        const disponibles = preguntasTodo.filter(p => !jugador.respondidas.includes(p.id));
        
        if (disponibles.length === 0) {
            // Si por alguna razón se acaban las preguntas globales antes de 10
            const puesto = obtenerPuesto(cleanUsername);
            socket.emit('game_completed', { puntos: jugador.puntos, puesto: puesto });
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

    socket.on('enviar_respuesta', ({ preguntaId, respuesta, intento, tiempoEmpleado }) => {
        const cleanUsername = socket.usernameClean;
        const jugador = jugadores[cleanUsername];
        if (!jugador) return;

        // CASO ESPECIAL: Se agotó el tiempo en el celular
        if (respuesta === "__TIEMPO_AGOTADO__") {
            jugador.respondidas.push(preguntaId);
            jugador.vidas -= 1;
            jugador.combo = 0;
            
            socket.emit('resultado_respuesta', { 
                correcta: false, 
                tiempoAgotado: true,
                intento: 2, 
                vidas: jugador.vidas 
            });
            enviarRanking();
            return;
        }

        const pregunta = preguntasTodo.find(p => p.id === preguntaId);
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
            // Es incorrecta
            if (intento === 1) {
                // Primer error silencioso: avisamos al cliente que gaste su intento
                socket.emit('resultado_respuesta', { correcta: false, intento: 1 });
            } else {
                // Segundo error en la misma pregunta: quita vida, rompe racha y avanza
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
    });
});

function obtenerPuesto(username) {
    let listaOrdenada = Object.values(jugadores).sort((a, b) => b.puntos - a.puntos);
    let index = listaOrdenada.findIndex(j => j.username === username);
    return index !== -1 ? index + 1 : listaOrdenada.length;
}

function enviarRanking() {
    let lista = Object.values(jugadores).sort((a, b) => b.puntos - a.puntos);
    io.emit('update_ranking', lista);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor patrio corriendo en puerto ${PORT}`));
