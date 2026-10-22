// PASTE AS: public/js/crypto.js  (replaces the old file)
// Day 7: the chat key can now be backed up. The private key is encrypted in the browser with a passphrase
// (PBKDF2 -> AES-GCM) and only that scrambled blob is sent to the server. The server never sees the passphrase or the key.
// Chat itself is unchanged: ECDH P-256 -> AES-GCM 256.
(function () {
  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const unb64url = (s) => { s = String(s).replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return unb64(s); };
  const subtle = window.crypto && window.crypto.subtle;
  const CURVE = { name: 'ECDH', namedCurve: 'P-256' };
  const KDF_ITERATIONS = 600000; // slows down anyone trying to guess a passphrase

  const E2EE = (window.E2EE = { available: !!subtle, myPub: null, aesKey: null, fingerprint: null, minPassphrase: 8 });
  let pair = null;

  // persistent=true makes a key that can be backed up. persistent=false is a one-call key that is never exportable.
  E2EE.init = async (persistent) => {
    if (!subtle) return false;
    pair = await subtle.generateKey(CURVE, !!persistent, ['deriveKey']);
    E2EE.myPub = b64(await subtle.exportKey('raw', pair.publicKey));
    E2EE.aesKey = null; E2EE.fingerprint = null;
    return true;
  };

  async function passphraseKey(pass, salt, iterations) {
    const base = await subtle.importKey('raw', new TextEncoder().encode(String(pass).normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
    return subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  // Encrypts the private key with the passphrase. Returns the blob to upload.
  E2EE.makeBackup = async (pass) => {
    if (!pair) throw new Error('No chat key to back up.');
    const jwk = await subtle.exportKey('jwk', pair.privateKey); // fails on purpose for a one-call key
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const k = await passphraseKey(pass, salt, KDF_ITERATIONS);
    const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode(JSON.stringify(jwk)));
    return { publicKey: E2EE.myPub, salt: b64(salt), iv: b64(iv), ciphertext: b64(ct), iterations: KDF_ITERATIONS };
  };

  // Opens a backup with the passphrase. Throws if the passphrase is wrong (and then changes nothing).
  E2EE.restore = async (blob, pass) => {
    const iterations = Number(blob.iterations);
    if (!(iterations >= 100000 && iterations <= 2000000)) throw new Error('Backup is not valid.');
    const k = await passphraseKey(pass, unb64(blob.salt), iterations);
    const plain = await subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv) }, k, unb64(blob.ciphertext)); // wrong passphrase fails here
    const jwk = JSON.parse(new TextDecoder().decode(plain));
    const privateKey = await subtle.importKey('jwk', jwk, CURVE, false, ['deriveKey']);
    // Rebuild the public key from the private key's own x/y, so we never trust the stored copy.
    const raw = new Uint8Array(65); raw[0] = 4; raw.set(unb64url(jwk.x), 1); raw.set(unb64url(jwk.y), 33);
    const publicKey = await subtle.importKey('raw', raw, CURVE, true, []);
    pair = { privateKey, publicKey };
    E2EE.myPub = b64(raw); E2EE.aesKey = null; E2EE.fingerprint = null;
  };

  E2EE.setPeer = async (peerPubB64) => {
    if (!subtle || !pair || !peerPubB64) return;
    const peerKey = await subtle.importKey('raw', unb64(peerPubB64), CURVE, false, []);
    E2EE.aesKey = await subtle.deriveKey({ name: 'ECDH', public: peerKey }, pair.privateKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    // Both sides compute the same short fingerprint from the two public keys.
    const sorted = [E2EE.myPub, peerPubB64].sort().join('|');
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(sorted));
    E2EE.fingerprint = [...new Uint8Array(digest)].slice(0, 4).map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();
  };

  E2EE.encrypt = async (text) => {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, E2EE.aesKey, new TextEncoder().encode(text));
    return { ciphertext: b64(ct), iv: b64(iv) };
  };

  E2EE.decrypt = async (ciphertext, iv) => {
    const pt = await subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, E2EE.aesKey, unb64(ciphertext));
    return new TextDecoder().decode(pt);
  };
})();
