<?php
// Swaps the one-time code a service gave the browser for tokens. Called by the Talqava app on the owner's computer.
declare(strict_types=1);
require __DIR__ . '/lib.php';

$config = settings();
$in = sent();
$s = service($config, $in['service'] ?? null);
$code = text($in['code'] ?? '');
if ($code === '') {
    answer(400, ['error' => 'The sign-in code is missing.']);
}
$fields = ['grant_type' => 'authorization_code', 'code' => $code, 'redirect_uri' => (string) $config['redirect']];
$verifier = text($in['code_verifier'] ?? '', 200);
if ($verifier !== '') {
    // The proof the app made when the sign-in started: a code taken by someone else is no use without it.
    $fields['code_verifier'] = $verifier;
}
exchange($s, tokenAddress($s, $in['asked'] ?? null), $fields);
