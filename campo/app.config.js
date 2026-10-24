/**
 * Acrescenta ao `app.json` a chave do Google Maps para Android (Geo-Rota,
 * 130) — SEM ela ir para o Git.
 *
 * ┌─ por que um arquivo a mais ───────────────────────────────────────┐
 * │ A chave do mapa da web mora no `.env` (gitignored), e esta segue o │
 * │ mesmo caminho: localmente vem de `campo/.env`; no build da EAS, da │
 * │ variável SENSÍVEL `GOOGLE_MAPS_ANDROID_KEY` do ambiente `preview`. │
 * │ Ela vai embutida no APK de qualquer jeito (é chave de cliente) —   │
 * │ quem a protege é a restrição no Google Cloud: só Maps SDK for      │
 * │ Android, só o pacote br.com.afline.campo com a SHA-1 do certificado.│
 * │                                                                    │
 * │ Build na EAS sem a chave FALHA aqui, em vez de sair um APK com o   │
 * │ mapa em branco (o Google não acusa nada: só não desenha).          │
 * └────────────────────────────────────────────────────────────────────┘
 */
module.exports = ({ config }) => {
  const chave = process.env.GOOGLE_MAPS_ANDROID_KEY
  if (process.env.EAS_BUILD && !chave) {
    throw new Error('Falta GOOGLE_MAPS_ANDROID_KEY no ambiente da EAS (eas env:create).')
  }
  return {
    ...config,
    plugins: [
      ...(config.plugins ?? []),
      ['react-native-maps', { androidGoogleMapsApiKey: chave }],
    ],
  }
}
