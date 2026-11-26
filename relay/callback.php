<?php
// Where a service sends the browser after the owner approves. It sends the browser on to the Talqava app on that
// same computer, and nowhere else: the address is always http://localhost, with the port the app put in "state".
declare(strict_types=1);

header('Cache-Control: no-store');
header('Referrer-Policy: no-referrer');
header('X-Content-Type-Options: nosniff');

$state = isset($_GET['state']) && is_string($_GET['state']) ? $_GET['state'] : '';
if (!preg_match('/^(\d{2,5})\.[A-Za-z0-9_-]{20,200}$/', $state, $m) || (int) $m[1] < 1024 || (int) $m[1] > 65535) {
    http_response_code(400);
    header('Content-Type: text/html; charset=utf-8');
    echo '<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>Talqava</title><p style="font:16px system-ui;margin:3rem auto;max-width:32rem">This sign-in did not start in Talqava, or it is too old. Open Talqava on your computer and start it again from Connections.</p>';
    exit;
}
$pass = ['state' => $state];
foreach (['code', 'error'] as $key) {
    if (isset($_GET[$key]) && is_string($_GET[$key]) && strlen($_GET[$key]) <= 4000) {
        $pass[$key] = $_GET[$key];
    }
}
header('Location: http://localhost:' . $m[1] . '/api/oauth/callback?' . http_build_query($pass), true, 302);
