'use strict';
// A persistent express-session store backed by node:sqlite (no external dependency).
// Replaces the default in-memory MemoryStore so sessions survive restarts and don't leak memory.
const session = require('express-session');
const db = require('./db');

class SqliteStore extends session.Store {
  constructor() { super(); setInterval(() => this._reap(), 1000 * 60 * 15).unref?.(); }
  _reap() { try { db.run('DELETE FROM sessions WHERE expire < ?', Date.now()); } catch (e) {} }
  get(sid, cb) {
    try {
      const row = db.get('SELECT sess, expire FROM sessions WHERE sid=?', sid);
      if (!row) return cb(null, null);
      if (row.expire < Date.now()) { this.destroy(sid, () => {}); return cb(null, null); }
      cb(null, JSON.parse(row.sess));
    } catch (e) { cb(e); }
  }
  set(sid, sess, cb) {
    try {
      const expire = sess.cookie && sess.cookie.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 1000 * 60 * 60 * 8;
      const json = JSON.stringify(sess);
      db.run('INSERT INTO sessions (sid,sess,expire) VALUES (?,?,?) ON CONFLICT(sid) DO UPDATE SET sess=excluded.sess, expire=excluded.expire', sid, json, expire);
      cb && cb(null);
    } catch (e) { cb && cb(e); }
  }
  destroy(sid, cb) { try { db.run('DELETE FROM sessions WHERE sid=?', sid); cb && cb(null); } catch (e) { cb && cb(e); } }
  touch(sid, sess, cb) {
    try {
      const expire = sess.cookie && sess.cookie.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 1000 * 60 * 60 * 8;
      db.run('UPDATE sessions SET expire=? WHERE sid=?', expire, sid);
      cb && cb(null);
    } catch (e) { cb && cb(e); }
  }
}
module.exports = SqliteStore;
