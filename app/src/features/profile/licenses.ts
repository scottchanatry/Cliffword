/**
 * What Cliffword is built on, and under which license (app/profile/licenses.tsx). Names,
 * copyright lines and license texts are data (legal text stays as published); what each part
 * does for the app is interface text, so it is a catalog key.
 *
 * The model weights are not bundled: the app downloads them from Hugging Face (see
 * src/adapters/model/descriptor.ts), and the Apache-2.0 text is shown here as the license asks.
 */
import { tKey, type CatalogKey } from '../../i18n';
import type { LicenseId } from './licenseTexts';

export interface LicenseEntry {
  id: string;
  /** Product name. */
  name: string;
  /** Copyright line as the project publishes it. */
  copyright: string;
  license: LicenseId;
  /** What it does in Cliffword. */
  role: CatalogKey;
  url: string;
}

/** SPDX ids as the screen names them. */
export const LICENSE_NAMES: Readonly<Record<LicenseId, string>> = {
  MIT: 'MIT License',
  'Apache-2.0': 'Apache License 2.0',
  'OFL-1.1': 'SIL Open Font License 1.1',
};

export const LICENSES: readonly LicenseEntry[] = [
  {
    id: 'qwen3',
    name: 'Qwen3-1.7B',
    copyright: 'Qwen team, Alibaba Cloud',
    license: 'Apache-2.0',
    role: tKey('licenses.role.model'),
    url: 'https://huggingface.co/Qwen/Qwen3-1.7B',
  },
  {
    id: 'llama.cpp',
    name: 'llama.cpp',
    copyright: 'Copyright (c) 2023-2026 The ggml authors',
    license: 'MIT',
    role: tKey('licenses.role.runtime'),
    url: 'https://github.com/ggml-org/llama.cpp',
  },
  {
    id: 'llama.rn',
    name: 'llama.rn',
    copyright: 'Copyright (c) 2023 Jhen-Jie Hong',
    license: 'MIT',
    role: tKey('licenses.role.binding'),
    url: 'https://github.com/mybigday/llama.rn',
  },
  {
    id: 'newsreader',
    name: 'Newsreader',
    copyright: 'Copyright 2020 The Newsreader Project Authors (http://github.com/productiontype/Newsreader)',
    license: 'OFL-1.1',
    role: tKey('licenses.role.fontContent'),
    url: 'https://fonts.google.com/specimen/Newsreader',
  },
  {
    id: 'inter',
    name: 'Inter',
    copyright: 'Copyright 2020 The Inter Project Authors (https://github.com/rsms/inter)',
    license: 'OFL-1.1',
    role: tKey('licenses.role.fontInterface'),
    url: 'https://fonts.google.com/specimen/Inter',
  },
  {
    id: 'anton',
    name: 'Anton',
    copyright: 'Copyright 2020 The Anton Project Authors (https://github.com/googlefonts/AntonFont.git)',
    license: 'OFL-1.1',
    role: tKey('licenses.role.fontMusic'),
    url: 'https://fonts.google.com/specimen/Anton',
  },
  {
    id: 'expo',
    name: 'Expo',
    copyright: 'Copyright (c) 2015-present 650 Industries, Inc. (aka Expo)',
    license: 'MIT',
    role: tKey('licenses.role.expo'),
    url: 'https://github.com/expo/expo',
  },
  {
    id: 'react-native',
    name: 'React Native',
    copyright: 'Copyright (c) Meta Platforms, Inc. and affiliates.',
    license: 'MIT',
    role: tKey('licenses.role.reactNative'),
    url: 'https://github.com/facebook/react-native',
  },
  {
    id: 'sql.js',
    name: 'sql.js',
    copyright: 'Copyright (c) 2017 sql.js authors',
    license: 'MIT',
    role: tKey('licenses.role.sqljs'),
    url: 'https://github.com/sql-js/sql.js',
  },
];
