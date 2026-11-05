import { Alert, Linking, Text, type StyleProp, type TextStyle } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { cor } from './tema'

/**
 * Texto que deixa COPIAR, e telefone que liga ou copia (D-310).
 *
 * > "equipes estão reclamando que eles não conseguem copiar o número de
 * >  telefone, do outro app concorrente eles conseguiam" — Emanuel, 04/11
 *
 * Dois jeitos, porque o técnico usa os dois:
 *  · o texto inteiro é `selectable`: segurar o dedo abre o "Copiar" do
 *    próprio Android — vale para observação, ponto de referência, endereço;
 *  · número de telefone no meio do texto vira link: tocar pergunta
 *    "Ligar" ou "Copiar". A observação do COP costuma vir assim:
 *    "(92)98577-4778 // PONTO DE REFERÊNCIA: …".
 * O padrão pega DDD com ou sem parênteses e 8 ou 9 dígitos, com ou sem
 * traço/espaço; não pega números curtos (protocolo, número da casa).
 */
const FONE = /(\(?\b\d{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}\b)/g

export function digitos(t: string) { return t.replace(/\D/g, '') }

/** Os DDDs que existem — sem isto o número da O.S. ("2614958081", 10
 *  dígitos) virava telefone. Celular: 9 depois do DDD; fixo: 2 a 5. */
const DDD = new Set([11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48, 49, 51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69, 71, 73, 74, 75,
  77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95, 96, 97, 98, 99])
export function ehTelefone(t: string) {
  const d = digitos(t)
  if (!DDD.has(Number(d.slice(0, 2)))) return false
  if (d.length === 11) return d[2] === '9'
  if (d.length === 10) return '2345'.includes(d[2])
  return false
}

/** Ligar ou copiar um número — o mesmo menu em todo o app. */
export function acoesTelefone(numero: string) {
  const d = digitos(numero)
  Alert.alert(numero, undefined, [
    { text: 'Copiar', onPress: () => { Clipboard.setStringAsync(d).catch(() => {}) } },
    { text: 'Ligar', onPress: () => { Linking.openURL(`tel:${d}`).catch(() => {}) } },
    { text: 'Cancelar', style: 'cancel' },
  ])
}

/** Copia e avisa — para o botão "Copiar" ao lado do "Ligar". */
export async function copiarTelefone(numero: string) {
  try {
    await Clipboard.setStringAsync(digitos(numero))
    Alert.alert('Número copiado', numero)
  } catch {
    Alert.alert('Não consegui copiar', 'Segure o dedo em cima do número para copiar.')
  }
}

export function TextoComTelefone({ texto, style }: { texto: string; style?: StyleProp<TextStyle> }) {
  const partes = texto.split(FONE)
  return (
    <Text style={style} selectable>
      {partes.map((p, k) => {
        const ehFone = k % 2 === 1 && ehTelefone(p)
        return ehFone ? (
          <Text key={k} onPress={() => acoesTelefone(p)} suppressHighlighting={false}
            style={{ color: cor.af700, textDecorationLine: 'underline', fontWeight: '700' }}
            accessibilityRole="link" accessibilityLabel={`Telefone ${p}: tocar para ligar ou copiar`}>
            {p}
          </Text>
        ) : p
      })}
    </Text>
  )
}
