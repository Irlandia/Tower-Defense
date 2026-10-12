<?php
// Tiny JSON API: player nicknames bound to IP + shared leaderboard of finished games.
// Storage: JSON files in api/data (denied to browsers by .htaccess), written under an exclusive lock.
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

const DATA_DIR = __DIR__ . '/data';
const MAX_SCORES = 500;

function client_ip(): string {
    // Behind Cloudflare the CF header is trustworthy (a client cannot set it); X-Forwarded-For is client-controlled
    // and only used as a fallback for hosts that put an honest proxy in front.
    $cf = $_SERVER['HTTP_CF_CONNECTING_IP'] ?? '';
    $fwd = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? '';
    $ip = $cf !== '' ? trim($cf) : ($fwd !== '' ? trim(explode(',', $fwd)[0]) : ($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0'));
    return filter_var($ip, FILTER_VALIDATE_IP) ? $ip : '0.0.0.0';
}

// Read-modify-write a JSON file atomically; $fn gets the decoded data by reference.
function with_json(string $name, callable $fn, bool $write = true) {
    if (!is_dir(DATA_DIR)) mkdir(DATA_DIR, 0755, true);
    $fh = fopen(DATA_DIR . "/$name.json", 'c+');
    if (!$fh) fail('storage unavailable', 500);
    flock($fh, $write ? LOCK_EX : LOCK_SH);
    $raw = stream_get_contents($fh);
    $data = json_decode($raw ?: '[]', true) ?: [];
    $result = $fn($data);
    if (!$write) { flock($fh, LOCK_UN); fclose($fh); return $result; } // read-only: no rewrite, shared lock
    ftruncate($fh, 0);
    rewind($fh);
    fwrite($fh, json_encode($data, JSON_UNESCAPED_UNICODE));
    fflush($fh);
    flock($fh, LOCK_UN);
    fclose($fh);
    return $result;
}

function fail(string $msg, int $code = 400): void {
    http_response_code($code);
    echo json_encode(['error' => $msg]);
    exit;
}

function clean_nick($s): string {
    $s = preg_replace('/[^\p{L}\p{N} _\-.]/u', '', (string)$s);
    return mb_substr(trim($s), 0, 16);
}

$action = $_GET['action'] ?? '';
$body = json_decode(file_get_contents('php://input') ?: '{}', true) ?: [];
$ip = client_ip();
$ipKey = hash('sha256', $ip); // never store raw IPs

switch ($action) {
    case 'nick':
        $nicks = with_json('nicks', fn(&$d) => $d, false);
        echo json_encode(['nick' => $nicks[$ipKey]['nick'] ?? '']);
        break;

    case 'set_nick':
        $nick = clean_nick($body['nick'] ?? '');
        if (mb_strlen($nick) < 2) fail('Нік має бути від 2 символів');
        with_json('nicks', function (&$d) use ($ipKey, $nick) { $d[$ipKey] = ['nick' => $nick, 't' => time()]; });
        echo json_encode(['nick' => $nick]);
        break;

    case 'scores':
        $mode = $_GET['mode'] ?? 'classic';
        $week = (int)($_GET['week'] ?? 0);
        $all = with_json('scores', fn(&$d) => $d, false);
        // brawl results only count for the current week's ruleset
        $list = array_values(array_filter($all, fn($r) => ($r['mode'] ?? 'classic') === $mode
            && ($mode !== 'brawl' || (int)($r['week'] ?? -1) === $week)));
        usort($list, fn($a, $b) => [$b['won'], $b['score'], $b['wave']] <=> [$a['won'], $a['score'], $a['wave']]);
        $top = array_map(function ($r) { unset($r['ip']); return $r; }, array_slice($list, 0, 20));
        echo json_encode(['scores' => $top]);
        break;

    case 'add_score':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('POST only', 405);
        $nicks = with_json('nicks', fn(&$d) => $d, false);
        $nick = $nicks[$ipKey]['nick'] ?? '';
        if ($nick === '') fail('Спершу введи нік');
        $diffs = ['normal' => 1, 'hard' => 1.4, 'nightmare' => 1.9];
        $mode = in_array($body['mode'] ?? '', ['classic', 'circle', 'brawl'], true) ? $body['mode'] : 'classic';
        $diff = isset($diffs[$body['diff'] ?? '']) ? $body['diff'] : 'normal';
        $wave = max(0, min(500, (int)($body['wave'] ?? 0)));
        $kills = max(0, min(100000, (int)($body['kills'] ?? 0)));
        $won = !empty($body['won']) && $wave >= 20;
        $row = [
            'nick' => $nick, 'mode' => $mode, 'diff' => $diff, 'wave' => $wave, 'kills' => $kills,
            'week' => (int)($body['week'] ?? 0), 'won' => $won, 'coop' => !empty($body['coop']), 'partner' => clean_nick($body['partner'] ?? ''),
            'score' => (int)round(($wave * 100 + $kills + ($won ? 1000 : 0)) * $diffs[$diff]),
            't' => time(),
        ];
        $ok = with_json('scores', function (&$d) use ($row, $ipKey) {
            // simple rate limit: one result per 20 s per IP
            foreach (array_reverse($d) as $r) {
                if (($r['ip'] ?? '') === $ipKey && time() - $r['t'] < 20) return false;
            }
            $d[] = $row + ['ip' => $ipKey];
            if (count($d) > MAX_SCORES) {
                usort($d, fn($a, $b) => $b['score'] <=> $a['score']);
                $d = array_slice($d, 0, MAX_SCORES);
            }
            return true;
        });
        if (!$ok) fail('Забагато запитів', 429);
        echo json_encode(['ok' => true, 'score' => $row['score']]);
        break;

    default:
        fail('unknown action');
}
