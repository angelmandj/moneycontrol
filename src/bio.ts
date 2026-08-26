/* Desbloqueo biométrico local (WebAuthn, autenticador de plataforma).
   La credencial se guarda SOLO en este dispositivo (localStorage), nunca en la nube.
   El PIN sigue siendo el respaldo si la biometría falla. */

const KEY = 'moneycontrol.bio'

export interface BioCred {
  id: string // credential ID en base64url
  createdAt: number
}

const b64u = {
  enc(buf: ArrayBuffer): string {
    let s = ''
    const b = new Uint8Array(buf)
    for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i])
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  },
  dec(s: string): Uint8Array {
    const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
    const u = new Uint8Array(b.length)
    for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i)
    return u
  },
}

export function loadBio(): BioCred | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const o = JSON.parse(raw)
    return o && typeof o.id === 'string' ? (o as BioCred) : null
  } catch {
    return null
  }
}

export function clearBio() {
  localStorage.removeItem(KEY)
}

/** ¿Este dispositivo tiene autenticador biométrico (huella/rostro) usable? */
export async function bioSupported(): Promise<boolean> {
  try {
    if (typeof PublicKeyCredential === 'undefined') return false
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
  } catch {
    return false
  }
}

/** Registra la huella/rostro de ESTE dispositivo. Devuelve la credencial o null si se canceló. */
export async function bioRegister(): Promise<BioCred | null> {
  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32))
    const userId = crypto.getRandomValues(new Uint8Array(16))
    const cred = (await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: 'MoneyControl' },
        user: { id: userId, name: 'moneycontrol@local', displayName: 'MoneyControl' },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 }, // ES256
          { type: 'public-key', alg: -257 }, // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'preferred',
        },
        timeout: 60000,
        attestation: 'none',
      },
    })) as PublicKeyCredential | null
    if (!cred || !cred.rawId) return null
    const c: BioCred = { id: b64u.enc(cred.rawId), createdAt: Date.now() }
    localStorage.setItem(KEY, JSON.stringify(c))
    return c
  } catch {
    return null
  }
}

/**
 * Pide huella/rostro y valida la respuesta localmente:
 * reto (challenge) correcto + bandera UV (usuario verificado) presente.
 */
export async function bioVerify(): Promise<boolean> {
  const saved = loadBio()
  if (!saved) return false
  try {
    const challengeBuf = crypto.getRandomValues(new Uint8Array(32))
    const challengeB64 = b64u.enc(challengeBuf.buffer as ArrayBuffer) // clientDataJSON.challenge viene en base64url sin padding
    const cred = (await navigator.credentials.get({
      publicKey: {
        challenge: challengeBuf,
        allowCredentials: [{ type: 'public-key', id: b64u.dec(saved.id) as BufferSource }],
        userVerification: 'required',
        timeout: 60000,
      },
    })) as PublicKeyCredential | null
    if (!cred) return false
    const resp = cred.response as AuthenticatorAssertionResponse
    const cd = JSON.parse(new TextDecoder().decode(resp.clientDataJSON))
    if (cd.challenge !== challengeB64 || cd.type !== 'webauthn.get') return false
    const flags = new Uint8Array(resp.authenticatorData)[32]
    return (flags & 0x04) !== 0 // bit UV: el autenticador verificó biométricamente al usuario
  } catch {
    return false
  }
}
