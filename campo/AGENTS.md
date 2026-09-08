# campo/ — o aplicativo do técnico

**Leia o `CLAUDE.md` da raiz primeiro.** As regras de ouro do projeto
valem aqui inteiras — principalmente a primeira: *não invente regra de
negócio, pergunte ao Emanuel*.

Depois leia o `README.md` desta pasta.

## Expo mudou

Este projeto é **Expo SDK 57 / React Native 0.86 / React 19**. A API de
vários módulos mudou nas últimas versões — `expo-file-system` virou
classe (`new File(uri).base64()`), `expo-camera` virou `CameraView` com
`useCameraPermissions`. Consulte a documentação **da versão**:
https://docs.expo.dev/versions/v57.0.0/

Melhor ainda: leia o `.d.ts` em `node_modules/<modulo>/build/`. Ele é o
que o `tsc` obedece; a documentação às vezes está uma versão atrás.

## O que não fazer aqui

- **Não coloque regra de negócio na tela.** As travas do campo (GPS na
  baixa, baixa que não se desfaz, anexo só no dia) moram na migration
  055. A tela só antecipa o recado para o botão não falhar sem
  explicar. Se você precisa de uma regra nova, ela nasce no banco e
  ganha cenário em `testar_campo()`.
- **Não mande `usuario_id` em INSERT nenhum.** Quem carimba o autor é o
  servidor (D-061).
- **Não use `toISOString()` para pegar uma data.** Manaus é UTC−4 e o
  dia vira às 20h. Use `isoLocal()` de `src/lib/formato.ts` (D-084).
- **Não instale biblioteca de UI.** `StyleSheet` e nada mais, como os
  gráficos SVG à mão da web.
- **Não use `npx expo install --fix` sem olhar**: ele mexe nas versões
  fixadas pelo SDK.

## Antes de terminar

```bash
npx tsc --noEmit
npx expo export --platform android --output-dir ../.tmp-export
```
