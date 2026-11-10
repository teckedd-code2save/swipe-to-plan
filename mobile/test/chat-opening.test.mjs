import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as planning from '../src/planning.js';
import * as flow from '../src/plan-flow.js';
import * as validation from '../src/validation.js';
import * as lifecycle from '../src/lifecycle.js';
import * as accountSession from '../src/account-session.js';
import * as accountPlanning from '../src/account-planning.js';
import * as library from '../src/library.js';
import * as transport from '../src/transport.js';
import * as dayDetails from '../src/day-details.js';

const source = await readFile(new URL('../App.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;

// Render the actual App JSX with native host adapters and explicitly injected
// hook-state fixtures. This checks output branches, not device lifecycle/events.
function renderOpening({ fontsLoaded = true, fontError = null, loaded = true, messages = [], draft, text = '' } = {}) {
  let stateIndex = 0;
  const state = { 1: loaded, 2: messages, 3: text };
  if (draft) state[0] = draft;
  const react = { ...React, useState(initial) {
    const index = stateIndex++;
    return React.useState(Object.hasOwn(state, index) ? state[index] : initial);
  } };
  const host = tag => ({ children, accessibilityLabel, accessibilityRole, value, placeholder, disabled, source, style }) =>
    React.createElement(tag, {
      'aria-label': accessibilityLabel, role: accessibilityRole,
      ...(tag === 'textarea' ? { defaultValue: value, placeholder, disabled } : {}),
      ...(tag === 'img' ? { src: source, alt: '', 'data-size': style?.width } : {}),
    }, ...(tag === 'img' || tag === 'textarea' ? [] : [children]));
  const native = {
    StyleSheet: { create: styles => styles }, Platform: { OS: 'android' },
    View: host('div'), Text: host('span'), Image: host('img'),
    TextInput: host('textarea'), Pressable: host('button'), ScrollView: host('div'),
    KeyboardAvoidingView: host('div'), ActivityIndicator: host('progress'),
  };
  const noop = () => null;
  const modules = {
    react, 'react-native': native,
    'react-native-safe-area-context': { SafeAreaProvider: host('main'), SafeAreaView: host('section') },
    '@expo-google-fonts/manrope': { useFonts: () => [fontsLoaded, fontError] },
    'expo-status-bar': { StatusBar: noop }, 'expo-crypto': {},
    '@expo/vector-icons/Ionicons': noop, 'expo/fetch': {}, 'expo-location': {},
    '@react-native-async-storage/async-storage': {},
    './src/components/AccountScreen': { NativeAccountScreen: noop },
    './src/components/ApiServerNotice': { ApiServerNotice: noop },
    './src/components/SavedLibrary': { SavedPlansScreen: noop, CirclesScreen: noop },
    './src/components/DayDetails': { DayReadiness: noop, VenueDetails: noop },
    './src/planning': planning, './src/plan-flow': flow, './src/validation': validation,
    './src/lifecycle': lifecycle, './src/account-session': accountSession,
    './src/account-planning': accountPlanning, './src/library': library,
    './src/transport': transport, './src/day-details': dayDetails,
    './assets/brand/unstressed-mark.png': 'brand-mark.png',
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, __DEV__: true, process: { env: {} },
    require: name => {
      assert.ok(Object.hasOwn(modules, name), `Unexpected import ${name}`);
      return modules[name];
    },
  });
  return renderToStaticMarkup(React.createElement(exports.default));
}

const marketing = /A GOOD DAY STARTS SMALL|Less figuring out|More heading out|A place to pause/;
const prompt = /What would you like to do\?/;

test('new or cleared draft renders a compact prompt, suggestions and composer without the hero', () => {
  for (const draft of [undefined, { brief: planning.newBrief(), confirmed: false, plan: null }]) {
    const markup = renderOpening({ draft });
    assert.match(markup, prompt);
    assert.match(markup, /A quiet place to sit after work/);
    assert.match(markup, /Message Unstressed/);
    assert.doesNotMatch(markup, marketing);
    assert.doesNotMatch(markup, /data-size="(?:60|64|76)"/);
    assert.equal((markup.match(/<img /g) || []).length, 1, 'Only the header carries the brand mark');
  }
});
test('first message and in-memory restored conversation show immediately without an intro', () => {
  for (const messages of [
    [{ role: 'user', text: 'Somewhere quiet nearby' }],
    [{ role: 'user', text: 'Somewhere quiet nearby' }, { role: 'assistant', text: 'Which area works for you?' }],
  ]) {
    const markup = renderOpening({ messages });
    assert.match(markup, /Somewhere quiet nearby/);
    assert.doesNotMatch(markup, prompt);
    assert.doesNotMatch(markup, marketing);
    assert.doesNotMatch(markup, /Loading Unstressed|Opening your draft/);
  }
});
test('restored plan takes priority over starter suggestions without changing the saved people', () => {
  const brief = { ...planning.newBrief(), area: 'Synthetic area', activities: ['coffee'], people: [{ id: 'you', name: 'You', artists: ['Sade'], vibes: [] }] };
  const draft = { brief, confirmed: true, plan: { status: 'complete', request: brief, stops: [{ id: 'one', intent: 'coffee', item: { id: 'fixture', name: 'Synthetic saved cafe' }, alternatives: [] }] } };
  assert.equal(validation.isPlan(draft.plan), true);
  const before = structuredClone(draft);
  const markup = renderOpening({ draft });
  assert.match(markup, /Synthetic saved cafe/);
  assert.match(markup, /View your outing/);
  assert.doesNotMatch(markup, prompt);
  assert.doesNotMatch(markup, marketing);
  assert.deepEqual(draft, before);
});
test('only unresolved fonts or draft restore use a startup indicator, and font failure proceeds', () => {
  const fonts = renderOpening({ fontsLoaded: false });
  assert.match(fonts, /Loading Unstressed/);
  assert.doesNotMatch(fonts, /Message Unstressed/);
  const storage = renderOpening({ loaded: false });
  assert.match(storage, /Opening your draft/);
  assert.doesNotMatch(storage, /Message Unstressed/);
  assert.match(renderOpening({ fontsLoaded: false, fontError: new Error('Font unavailable') }), /Message Unstressed/);
  assert.doesNotMatch(fonts + storage, marketing);
});
test('typing stays editable and suggestions only fill and focus the composer', () => {
  assert.match(renderOpening({ text: 'My own idea' }), /My own idea<\/textarea>/);
  assert.match(source, /onPress=\{\(\) => \{ setText\(suggestion\); composer\.current\?\.focus\(\); \}\}/);
  assert.doesNotMatch(source, /styles\.hero|heroSun|heroTitle|heroText/);
});
test('startup is readiness-driven, never timed or replayed on foreground or new outing', () => {
  const lifecycleEffect = source.slice(source.indexOf('disk\n      .load()'), source.indexOf('useEffect(() => accountSession.subscribe'));
  assert.match(lifecycleEffect, /\.finally\(\(\) => \{\s*if \(mounted.current\) setLoaded\(true\)/);
  const foreground = lifecycleEffect.slice(lifecycleEffect.indexOf('AppState.addEventListener'));
  assert.doesNotMatch(foreground, /setLoaded|setMessages|setDraft|setTimeout|setInterval/);
  const newOuting = source.slice(source.indexOf('function newOuting()'), source.indexOf('const plan = preview'));
  assert.match(newOuting, /setMessages\(\[\]\)/);
  assert.doesNotMatch(newOuting, /setLoaded|setTimeout|setInterval/);
  assert.doesNotMatch(source.slice(source.indexOf('function Planner()')), /setLoaded\(false\)|setTimeout|setInterval|minimumSplash|introDismissed/);
});
