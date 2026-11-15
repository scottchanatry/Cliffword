/** The sql.js build with the WebAssembly embedded in the JavaScript file (same API as 'sql.js'). */
declare module 'sql.js/dist/sql-wasm-inline.js' {
  import initSqlJs from 'sql.js';
  export default initSqlJs;
}
