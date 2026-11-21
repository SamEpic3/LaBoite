// Petit serveur WebSocket (RFC 6455) sans dépendance, suffisant pour des messages JSON.
const crypto = require("crypto");
const { EventEmitter } = require("events");

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const TAILLE_MAX = 64 * 1024; // un message du jeu fait moins de 1 ko
const INTERVALLE_PING = 25000;

class Connexion extends EventEmitter {
    constructor(socket) {
        super();
        this.socket = socket;
        this.tampon = Buffer.alloc(0);
        this.fragments = [];
        this.ouverte = true;
        this.vivante = true;
        socket.setNoDelay(true);
        socket.on("data", (d) => this.recevoir(d));
        socket.on("close", () => this.fermee());
        socket.on("error", () => this.fermee());
        // Ping régulier : garde la connexion ouverte derrière les proxys et détecte les clients disparus.
        this.ping = setInterval(() => {
            if (!this.vivante) return this.socket.destroy();
            this.vivante = false;
            this.trame(0x9, Buffer.alloc(0));
        }, INTERVALLE_PING);
    }

    recevoir(donnees) {
        this.tampon = Buffer.concat([this.tampon, donnees]);
        while (this.ouverte) {
            const b = this.tampon;
            if (b.length < 2) return;
            const fin = (b[0] & 0x80) !== 0;
            const op = b[0] & 0x0f;
            const masque = (b[1] & 0x80) !== 0;
            let longueur = b[1] & 0x7f;
            let pos = 2;
            if (longueur === 126) {
                if (b.length < 4) return;
                longueur = b.readUInt16BE(2);
                pos = 4;
            } else if (longueur === 127) {
                if (b.length < 10) return;
                const grand = b.readBigUInt64BE(2);
                if (grand > BigInt(TAILLE_MAX)) return this.fermer(1009);
                longueur = Number(grand);
                pos = 10;
            }
            if (!masque) return this.fermer(1002); // un client doit toujours masquer ses trames
            if (longueur > TAILLE_MAX) return this.fermer(1009);
            if (b.length < pos + 4 + longueur) return;
            const cle = b.subarray(pos, pos + 4);
            const charge = Buffer.from(b.subarray(pos + 4, pos + 4 + longueur));
            for (let i = 0; i < charge.length; i++) charge[i] ^= cle[i % 4];
            this.tampon = b.subarray(pos + 4 + longueur);
            this.vivante = true;

            if (op === 0x1 || op === 0x0) {
                this.fragments.push(charge);
                if (this.fragments.reduce((t, f) => t + f.length, 0) > TAILLE_MAX) return this.fermer(1009);
                if (fin) {
                    const texte = Buffer.concat(this.fragments).toString("utf8");
                    this.fragments = [];
                    this.emit("message", texte);
                }
            } else if (op === 0x8) {
                return this.fermer(1000);
            } else if (op === 0x9) {
                this.trame(0xa, charge);
            } else if (op === 0x2) {
                return this.fermer(1003); // pas de binaire
            }
        }
    }

    trame(op, charge) {
        if (!this.ouverte) return;
        const n = charge.length;
        let entete;
        if (n < 126) {
            entete = Buffer.from([0x80 | op, n]);
        } else if (n < 65536) {
            entete = Buffer.alloc(4);
            entete[0] = 0x80 | op;
            entete[1] = 126;
            entete.writeUInt16BE(n, 2);
        } else {
            entete = Buffer.alloc(10);
            entete[0] = 0x80 | op;
            entete[1] = 127;
            entete.writeBigUInt64BE(BigInt(n), 2);
        }
        this.socket.write(Buffer.concat([entete, charge]));
    }

    envoyer(objet) {
        this.trame(0x1, Buffer.from(JSON.stringify(objet), "utf8"));
    }

    fermer(code = 1000) {
        if (!this.ouverte) return;
        const c = Buffer.alloc(2);
        c.writeUInt16BE(code);
        this.trame(0x8, c);
        this.socket.end();
        this.fermee();
    }

    fermee() {
        if (!this.ouverte) return;
        this.ouverte = false;
        clearInterval(this.ping);
        this.socket.destroy();
        this.emit("close");
    }
}

// Branche le WebSocket sur un serveur http existant. surConnexion(conn) est appelé pour chaque client.
function brancherWebSocket(serveur, chemin, surConnexion) {
    serveur.on("upgrade", (req, socket) => {
        const url = new URL(req.url, "http://x");
        const cle = req.headers["sec-websocket-key"];
        if (url.pathname !== chemin || !cle || (req.headers.upgrade || "").toLowerCase() !== "websocket") {
            socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
            return;
        }
        const accepte = crypto.createHash("sha1").update(cle + GUID).digest("base64");
        socket.write(
            "HTTP/1.1 101 Switching Protocols\r\n" +
            "Upgrade: websocket\r\nConnection: Upgrade\r\n" +
            `Sec-WebSocket-Accept: ${accepte}\r\n\r\n`
        );
        surConnexion(new Connexion(socket));
    });
}

module.exports = { brancherWebSocket };
