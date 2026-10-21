/* MatchBoard – Login, Datenzugriff, Offline-Zwischenspeicher und Profilbilder
   Benötigt vorher: supabase-js (CDN) und shared/config.js
   Alle Daten liegen in Supabase (Tabellen matchboard_*), Zugang über overall_app_access (App "matchboard"). */
(function () {
    const APP = 'matchboard';
    const cfg = window.MB_CONFIG || {};
    const configured = !!(cfg.url && cfg.key && !/DEIN-PROJEKT|DEIN-PUBLISHABLE/.test(cfg.url + cfg.key));
    const sb = configured && window.supabase
        ? window.supabase.createClient(cfg.url, cfg.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
        : null;

    /* Offline-Zwischenspeicher: zuletzt geladener Stand bleibt auf dem Gerät. Wird beim Abmelden gelöscht. */
    const CACHE = 'mb_cache_v1_';
    const cacheGet = k => { try { return JSON.parse(localStorage.getItem(CACHE + k)); } catch (e) { return null; } };
    const cacheSet = (k, v) => { try { localStorage.setItem(CACHE + k, JSON.stringify(v)); } catch (e) {} };
    function clearCache() {
        try { Object.keys(localStorage).filter(k => k.startsWith(CACHE)).forEach(k => localStorage.removeItem(k)); } catch (e) {}
    }
    const isNetErr = e => !navigator.onLine || /fetch|network|load failed|timeout/i.test(String(e && (e.message || e)));
    const check = ({ data, error }) => { if (error) throw error; return data; };
    const needSb = () => { if (!sb) throw new Error('Supabase ist noch nicht eingerichtet (shared/config.js).'); };

    const pad = n => String(n).padStart(2, '0');
    const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

    async function getSession() {
        if (!sb) return null;
        try { return (await sb.auth.getSession()).data.session; } catch (e) { return null; }
    }

    const MATCH = 'id, title, game, category_id, played_on, location_id, outcome, winner_id, score, guests, notes, created_by, created_at, updated_at';
    const NO_ACCESS = 'Dein Konto hat noch keinen Zugang zum MatchBoard.';

    /* Kompletter Stand: { players, categories, locations, matches, me: { id, email, role }, offline } */
    async function loadAll() {
        const session = await getSession();
        if (!session) return null;
        const key = 'all_' + session.user.id;
        try {
            const role = check(await sb.rpc('overall_app_role', { p_app: APP }));
            if (!role || role === 'guest') throw new Error(NO_ACCESS);
            const [players, categories, locations, matches] = await Promise.all([
                sb.rpc('matchboard_players').then(check),
                sb.from('matchboard_categories').select('*').order('sort').then(check),
                sb.from('matchboard_locations').select('id, name, region, lat, lng').order('name').then(check),
                sb.from('matchboard_matches').select(MATCH).order('played_on', { ascending: false }).order('created_at', { ascending: false }).then(check)
            ]);
            const own = check(await sb.from('overall_profiles').select('display_name, avatar_path').eq('id', session.user.id).maybeSingle()) || {};
            const all = { players, categories, locations, matches,
                me: { id: session.user.id, email: session.user.email, role, display_name: own.display_name, avatar_path: own.avatar_path } };
            cacheSet(key, all);
            return { ...all, offline: false };
        } catch (e) {
            const cached = cacheGet(key);
            if (cached && isNetErr(e)) return { ...cached, offline: true };
            throw e;
        }
    }

    /* Match anlegen (ohne id) oder ändern (mit id). Gibt die gespeicherte Zeile zurück. */
    async function saveMatch(m) {
        const row = {
            title: m.title, game: m.game, category_id: m.category_id, played_on: m.played_on, location_id: m.location_id || null,
            outcome: m.winner_id ? 'win' : 'draw', winner_id: m.winner_id || null, score: m.score || null,
            guests: m.guests || [], notes: m.notes || null
        };
        needSb();
        const q = m.id ? sb.from('matchboard_matches').update(row).eq('id', m.id) : sb.from('matchboard_matches').insert(row);
        const rows = check(await q.select(MATCH));
        if (!rows || !rows.length) throw new Error('Keine Berechtigung für diese Aktion.');
        return rows[0];
    }

    async function deleteMatch(id) {
        needSb();
        const rows = check(await sb.from('matchboard_matches').delete().eq('id', id).select('id'));
        if (!rows || !rows.length) throw new Error('Löschen dürfen nur Stefan oder wer das Match eingetragen hat.');
    }

    /* Neuen Ort anlegen: { name, region, lat, lng } → Zeile mit id */
    async function addLocation(l) {
        const row = { name: l.name.trim(), region: (l.region || '').trim() || null, lat: +l.lat, lng: +l.lng };
        needSb();
        return check(await sb.from('matchboard_locations').insert(row).select('id, name, region, lat, lng').single());
    }

    async function signIn(email, password) {
        needSb();
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
    }

    /* Abmelden nur auf diesem Gerät; ist die Sitzung schon anderswo beendet, räumen wir sie selbst weg */
    async function signOut() {
        clearCache();
        if (!sb) return;
        try {
            const { error } = await sb.auth.signOut({ scope: 'local' });
            if (!error) return;
        } catch (e) {}
        try {
            const key = sb.auth.storageKey;
            Object.keys(localStorage).filter(k => k === key || k.startsWith(key + '-')).forEach(k => localStorage.removeItem(k));
        } catch (e) {}
    }

    async function resetPassword(email) {
        needSb();
        const redirectTo = location.origin + location.pathname.replace(/[^/]*$/, '');
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
        if (error) throw error;
    }

    /* Passwort gegen die Datenleck-Liste von HaveIBeenPwned prüfen. Nur die ersten 5 Zeichen des
       SHA-1-Hashs verlassen den Browser, verglichen wird lokal. 0 auch, wenn der Dienst nicht erreichbar ist. */
    async function pwnedCount(password) {
        try {
            const hash = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(password));
            const hex = [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
            const res = await fetch('https://api.pwnedpasswords.com/range/' + hex.slice(0, 5), { signal: AbortSignal.timeout(5000) });
            if (!res.ok) return 0;
            const line = (await res.text()).split('\n').find(l => l.startsWith(hex.slice(5) + ':'));
            return line ? parseInt(line.split(':')[1], 10) || 0 : 0;
        } catch (e) { return 0; }
    }

    async function updatePassword(password) {
        const leaks = await pwnedCount(password);
        if (leaks) throw new Error(`Dieses Passwort ist aus Datenlecks bekannt (${leaks.toLocaleString('de-DE')}× gefunden). Bitte wähle ein anderes.`);
        const { error } = await sb.auth.updateUser({ password });
        if (error) throw error;
    }

    /* Profilbilder liegen global im privaten Bucket "avatars" (Pfad in overall_profiles.avatar_path, ein Bild für alle Apps).
       Angezeigt werden sie über kurzlebige signierte Links; wer welches Bild sehen darf, prüft Supabase:
       das eigene immer, das des Mitspielers über die Policy matchboard_avatars_select. */
    const signed = {};   /* Pfad → { url, until } */
    async function avatarUrls(paths) {
        paths = [...new Set(paths.filter(Boolean))];
        const now = Date.now(), missing = paths.filter(p => !signed[p] || signed[p].until < now);
        if (sb && missing.length) {
            try {
                const rows = check(await sb.storage.from('avatars').createSignedUrls(missing, 3600));
                rows.forEach(r => { if (r.signedUrl && !r.error) signed[r.path] = { url: r.signedUrl, until: now + 50 * 60 * 1000 }; });
            } catch (e) { /* offline oder keine Berechtigung → Initialen */ }
        }
        return Object.fromEntries(paths.filter(p => signed[p]).map(p => [p, signed[p].url]));
    }

    /* Deutsche Fehlermeldungen für die häufigsten Fälle */
    function errorText(e) {
        const m = String(e && (e.message || e));
        if (/invalid login credentials/i.test(m)) return 'E-Mail oder Passwort ist falsch.';
        if (/email not confirmed/i.test(m)) return 'Diese E-Mail ist noch nicht bestätigt. Schau in dein Postfach.';
        if (/password should be at least|weak password/i.test(m)) return 'Das Passwort ist zu kurz oder zu einfach (mind. 8 Zeichen empfohlen).';
        if (/permission denied for table|could not find the function|relation .* does not exist|schema cache/i.test(m))
            return 'Die Datenbank ist noch nicht eingerichtet (Migration supabase/migrations/…_matchboard_core.sql).';
        if (/matchboard_locations_name_key|duplicate key/i.test(m)) return 'Diesen Ort gibt es schon. Bitte aus der Liste wählen.';
        if (/row-level security/i.test(m)) return 'Keine Berechtigung für diese Aktion.';
        if (/rate limit|too many/i.test(m)) return 'Zu viele Versuche – bitte kurz warten.';
        if (isNetErr(e)) return 'Keine Verbindung zum Server. Bist du online?';
        return m;
    }

    window.MB = { sb, configured, today, getSession, loadAll, saveMatch, deleteMatch, addLocation, signIn, signOut,
        resetPassword, updatePassword, errorText, clearCache, avatarUrls,
        onAuth: cb => sb && sb.auth.onAuthStateChange((ev, session) => cb(ev, session)) };
})();
