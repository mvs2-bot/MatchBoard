/* MatchBoard – Login, Datenzugriff, Offline-Zwischenspeicher und Demo-Modus
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

    /* ───────── Demo-Modus: die 12 Matches vom Sommer 2026, nur im Browser ───────── */
    let demo = null;
    function demoData() {
        const players = [
            { id: 'demo-stefan', display_name: 'Stefan', avatar_path: null, role: 'admin' },
            { id: 'demo-ines', display_name: 'Ines', avatar_path: null, role: 'member' }
        ];
        const categories = [
            ['sport', 'Sport', '⚽', '#16a34a', 10], ['geschick', 'Geschicklichkeit', '🎯', '#ea580c', 20],
            ['karten', 'Kartenspiele', '🃏', '#dc2626', 30], ['wuerfel', 'Würfelspiele', '🎲', '#7c3aed', 40],
            ['brett', 'Gesellschafts- & Brettspiele', '♟️', '#0891b2', 50], ['quiz', 'Quiz & Wissen', '🧠', '#db2777', 60],
            ['video', 'Videospiele', '🎮', '#2563eb', 70], ['sonstiges', 'Sonstiges', '✨', '#64748b', 99]
        ].map(([id, label, emoji, color, sort]) => ({ id, label, emoji, color, sort }));
        const locations = [
            ['l1', 'Bregenz', 'Vorarlberg, AT', 47.5031, 9.7471], ['l2', 'Strandbad Bruggerhorn', 'St. Margrethen, CH', 47.4505, 9.6580],
            ['l3', 'Camping Werdenberg', 'Buchs SG, CH', 47.1659, 9.4651], ['l4', 'Frutigresort', 'Frutigen, CH', 46.5870, 7.6440],
            ['l5', 'Blüemlisalphütte', 'Kandersteg, CH', 46.4950, 7.7630], ['l6', 'Zürich', 'Zürich, CH', 47.3769, 8.5417],
            ['l7', 'Reschensee', 'Vinschgau, IT', 46.8100, 10.5300]
        ].map(([id, name, region, lat, lng]) => ({ id, name, region, lat, lng }));
        const S = 'demo-stefan', I = 'demo-ines';
        const matches = [
            ['Mülleimer werfen', 'Mülleimer werfen', 'geschick', '2026-07-18', 'l1', I],
            ['Kickern', 'Kickern', 'sport', '2026-07-18', 'l2', S],
            ['Kniffel', 'Kniffel', 'wuerfel', '2026-07-18', 'l2', S],
            ['Minigolf', 'Minigolf', 'sport', '2026-07-19', 'l3', S],
            ['Fippern', 'Flippern', 'geschick', '2026-07-19', 'l3', S],
            ['Minigolf', 'Minigolf', 'sport', '2026-07-20', 'l4', I],
            ['Kniffeln Hütte', 'Kniffel', 'wuerfel', '2026-07-21', 'l5', I],
            ['Kickern Mohamed', 'Kickern', 'sport', '2026-07-24', 'l6', S, ['Mohamed'], 'Match mit Mohamed'],
            ['Minigolf Zürich', 'Minigolf', 'sport', '2026-07-24', 'l6', I],
            ['Kickern Italien', 'Kickern', 'sport', '2026-07-25', 'l7', S],
            ['Kniffel Italien', 'Kniffel', 'wuerfel', '2026-07-25', 'l7', I],
            ['Bogenschießen', 'Bogenschießen', 'sport', '2026-07-25', 'l7', S]
        ].map(([title, game, category_id, played_on, location_id, winner_id, guests, notes], i) => ({
            id: 'm' + (i + 1), title, game, category_id, played_on, location_id, outcome: 'win', winner_id,
            score: null, guests: guests || [], notes: notes || null, created_by: winner_id, created_at: played_on + 'T12:00:' + pad(i) + 'Z'
        }));
        return { players, categories, locations, matches, me: { id: S, email: 'demo', role: 'admin' }, demo: true, offline: false };
    }

    async function getSession() {
        if (!sb) return null;
        try { return (await sb.auth.getSession()).data.session; } catch (e) { return null; }
    }

    const MATCH = 'id, title, game, category_id, played_on, location_id, outcome, winner_id, score, guests, notes, created_by, created_at, updated_at';
    const NO_ACCESS = 'Dein Konto hat noch keinen Zugang zum MatchBoard.';

    /* Kompletter Stand: { players, categories, locations, matches, me: { id, email, role }, offline, demo } */
    async function loadAll() {
        if (demo) return demo;
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
            const all = { players, categories, locations, matches, me: { id: session.user.id, email: session.user.email, role } };
            cacheSet(key, all);
            return { ...all, offline: false, demo: false };
        } catch (e) {
            const cached = cacheGet(key);
            if (cached && isNetErr(e)) return { ...cached, offline: true, demo: false };
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
        if (demo) {
            if (m.id) { const i = demo.matches.findIndex(x => x.id === m.id); demo.matches[i] = { ...demo.matches[i], ...row }; return demo.matches[i]; }
            const saved = { ...row, id: 'm' + Date.now(), created_by: demo.me.id, created_at: new Date().toISOString() };
            demo.matches.unshift(saved);
            return saved;
        }
        needSb();
        const q = m.id ? sb.from('matchboard_matches').update(row).eq('id', m.id) : sb.from('matchboard_matches').insert(row);
        const rows = check(await q.select(MATCH));
        if (!rows || !rows.length) throw new Error('Keine Berechtigung für diese Aktion.');
        return rows[0];
    }

    async function deleteMatch(id) {
        if (demo) { demo.matches = demo.matches.filter(x => x.id !== id); return; }
        needSb();
        const rows = check(await sb.from('matchboard_matches').delete().eq('id', id).select('id'));
        if (!rows || !rows.length) throw new Error('Löschen dürfen nur Stefan oder wer das Match eingetragen hat.');
    }

    /* Neuen Ort anlegen: { name, region, lat, lng } → Zeile mit id */
    async function addLocation(l) {
        const row = { name: l.name.trim(), region: (l.region || '').trim() || null, lat: +l.lat, lng: +l.lng };
        if (demo) { const saved = { ...row, id: 'l' + Date.now() }; demo.locations.push(saved); return saved; }
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
        if (demo) { demo = null; return; }
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

    async function updatePassword(password) {
        const { error } = await sb.auth.updateUser({ password });
        if (error) throw error;
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
        resetPassword, updatePassword, errorText, clearCache,
        startDemo: () => { demo = demoData(); return demo; },
        isDemo: () => !!demo,
        onAuth: cb => sb && sb.auth.onAuthStateChange((ev, session) => cb(ev, session)) };
})();
