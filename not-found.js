import { getLocale, mountLocale } from './i18n.js';
mountLocale();
const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
const destination = (local ? './' : '/project-garden/') + '?lang=' + getLocale();
document.querySelector('main a').href = destination;
const refresh = document.querySelector('meta[http-equiv="refresh"]');
if (refresh) refresh.content = '4; url=' + destination;
