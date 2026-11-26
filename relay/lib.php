<?php
// Talqava's sign-in service: what its pages share. See README.md.
//
// It does one job. Some services give an app a secret, which cannot be kept in an app on someone's computer. This
// service keeps those secrets, swaps a one-time sign-in code for tokens, and renews tokens. It stores nothing about
// anyone: no tokens, no codes, no log of either. What a service answers goes straight back to the Talqava app that asked.
declare(strict_types=1);

const TALQAVA_MAX_BODY = 20000;

/** Sends a JSON answer and stops. Nothing here may be cached. */
function answer(int $status, array $body): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: no-referrer');
    echo json_encode($body, JSON_UNESCAPED_SLASHES);
    exit;
}

/** The settings, kept outside the website's folder so they can never be served as a page. */
function settings(): array
{
    $path = getenv('TALQAVA_AUTH_CONFIG') ?: dirname(__DIR__, 2) . '/talqava-auth-config.php';
    if (!is_file($path)) {
        answer(503, ['error' => 'The sign-in service is not set up yet.']);
    }
    $config = require $path;
    if (!is_array($config) || !isset($config['redirect'], $config['services']) || !is_array($config['services'])) {
        answer(503, ['error' => 'The sign-in service is not set up correctly.']);
    }
    return $config;
}

/** What was sent, as JSON. Only POST, only JSON, and only a small body. */
function sent(): array
{
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        answer(405, ['error' => 'Send this with POST.']);
    }
    $raw = file_get_contents('php://input', false, null, 0, TALQAVA_MAX_BODY + 1);
    if ($raw === false || strlen($raw) > TALQAVA_MAX_BODY) {
        answer(413, ['error' => 'That request is too large.']);
    }
    $data = json_decode($raw, true);
    if (!is_array($data)) {
        answer(400, ['error' => 'Send JSON.']);
    }
    return $data;
}

/** One service's settings, by its id. */
function service(array $config, mixed $id): array
{
    if (!is_string($id) || !preg_match('/^[a-z][a-z0-9]{1,30}$/', $id) || !isset($config['services'][$id])) {
        answer(404, ['error' => 'This service does not sign in through Talqava.']);
    }
    $s = $config['services'][$id];
    if (empty($s['client_id']) || empty($s['client_secret']) || empty($s['token_url'])) {
        answer(503, ['error' => 'This service is not set up yet.']);
    }
    return $s;
}

/** A short text value, or nothing. */
function text(mixed $v, int $most = 4000): string
{
    return is_string($v) && strlen($v) <= $most ? $v : '';
}

/**
 * The service's token address. A few services sign in at an address of the account's own (its subdomain); the
 * settings say which values may be filled in, and each must look like one label of a host name, so it can never
 * point the request somewhere else.
 */
function tokenAddress(array $s, mixed $asked): string
{
    $url = (string) $s['token_url'];
    foreach (($s['ask'] ?? []) as $key) {
        $value = is_array($asked) ? strtolower(text($asked[$key] ?? '', 63)) : '';
        if (!preg_match('/^[a-z0-9][a-z0-9-]{0,62}$/', $value)) {
            answer(400, ['error' => 'A value needed to sign in is missing.']);
        }
        $url = str_replace('{' . $key . '}', $value, $url);
    }
    if (!str_starts_with($url, 'https://') || str_contains($url, '{')) {
        answer(503, ['error' => 'This service is not set up correctly.']);
    }
    return $url;
}

/**
 * Asks the service for tokens and passes its answer back. Services differ in how they want the app's secret:
 * "form" (in the form, the usual), "basic" (as a Basic sign-in header), "basic_with_id" (the header, and the app's
 * ID in the form as well, as Calendly asks) or "json" (in a JSON body).
 */
function exchange(array $s, string $url, array $fields): never
{
    $style = $s['style'] ?? 'form';
    $headers = ['Accept: application/json', 'User-Agent: Talqava sign-in service'];
    if ($style === 'basic' || $style === 'basic_with_id') {
        $headers[] = 'Authorization: Basic ' . base64_encode($s['client_id'] . ':' . $s['client_secret']);
        $body = http_build_query($style === 'basic_with_id' ? $fields + ['client_id' => $s['client_id']] : $fields);
        $headers[] = 'Content-Type: application/x-www-form-urlencoded';
    } elseif ($style === 'json') {
        $body = json_encode($fields + ['client_id' => $s['client_id'], 'client_secret' => $s['client_secret']]);
        $headers[] = 'Content-Type: application/json';
    } else {
        $body = http_build_query($fields + ['client_id' => $s['client_id'], 'client_secret' => $s['client_secret']]);
        $headers[] = 'Content-Type: application/x-www-form-urlencoded';
    }
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $body,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_TIMEOUT => 20,
        CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
    ]);
    $raw = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    if ($raw === false) {
        answer(502, ['error' => 'The service could not be reached. Try again in a minute.']);
    }
    $data = json_decode((string) $raw, true);
    if ($status < 200 || $status >= 300 || !is_array($data) || empty($data['access_token'])) {
        // The service's own reason, in a few words; never the request or anything secret.
        $why = is_array($data) ? text($data['error_description'] ?? ($data['error'] ?? ''), 200) : '';
        answer(400, ['error' => $why !== '' ? $why : 'The service did not complete the sign-in.']);
    }
    // Only what the app needs is passed on.
    $keep = array_merge(['access_token', 'refresh_token', 'expires_in', 'token_type', 'scope'], $s['pass'] ?? []);
    answer(200, array_intersect_key($data, array_flip($keep)));
}
