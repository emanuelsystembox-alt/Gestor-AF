import { registerRootComponent } from 'expo';

// Antes do App, e não dentro dele: no Android o sistema pode acordar o JS
// SEM tela só para entregar a posição do segundo plano — e aí só existe a
// tarefa que foi definida no carregamento. Ver src/lib/rastro.ts (096).
import './src/lib/rastro';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
