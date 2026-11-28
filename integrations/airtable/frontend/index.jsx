import React from 'react';
import { initializeBlock, loadCSSFromString } from '@airtable/blocks/ui';
import ForgeApp from './ForgeApp.jsx';
import { STYLES } from './styles.js';

loadCSSFromString(STYLES);
initializeBlock(() => <ForgeApp />);
