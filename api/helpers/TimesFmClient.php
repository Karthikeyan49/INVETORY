<?php
declare(strict_types=1);

/**
 * Thin HTTP client for the TimesFM 2.5 forecasting microservice.
 *
 * The service runs locally (see TIMESFM_URL, default http://127.0.0.1:8600) and
 * exposes:
 *   POST /forecast  {"series":[...], "horizon":N}  ->  {"forecast":[...]}
 *   GET  /health                                    ->  {"status":"ok"}
 *
 * Every call is best-effort: on any curl/HTTP/parse failure it returns null (or
 * false for health) so callers can fall back to a non-AI estimate instead of
 * erroring. The service is never a hard dependency of the ERP.
 */
class TimesFmClient
{
    private const CONNECT_TIMEOUT = 3;
    private const TIMEOUT         = 8;
    private const MIN_SERIES      = 8;

    private static function baseUrl(): string
    {
        $url = defined('TIMESFM_URL') ? (string)TIMESFM_URL : 'http://127.0.0.1:8600';
        return rtrim($url, '/');
    }

    /**
     * Request headers. Adds a bearer token when TIMESFM_TOKEN is set, so a
     * network-exposed service (model on a different host) stays authenticated.
     * With no token (localhost same-host) it sends only the content type.
     *
     * @return string[]
     */
    private static function headers(): array
    {
        $headers = ['Content-Type: application/json'];
        $token   = defined('TIMESFM_TOKEN') ? (string)TIMESFM_TOKEN : '';
        if ($token !== '') {
            $headers[] = 'Authorization: Bearer ' . $token;
        }
        return $headers;
    }

    /**
     * Forecast the next $horizon values of a numeric series.
     *
     * @param float[] $series  historical values, oldest -> newest
     * @param int     $horizon number of future steps to predict
     * @return float[]|null    forecast values, or null if the service is unavailable
     */
    public static function forecast(array $series, int $horizon): ?array
    {
        $series = array_values(array_map('floatval', $series));
        if (count($series) < self::MIN_SERIES || $horizon < 1) {
            return null;
        }

        $payload = json_encode(['series' => $series, 'horizon' => $horizon]);
        if ($payload === false) {
            return null;
        }

        $ch = curl_init(self::baseUrl() . '/forecast');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $payload,
            CURLOPT_CONNECTTIMEOUT => self::CONNECT_TIMEOUT,
            CURLOPT_TIMEOUT        => self::TIMEOUT,
            CURLOPT_HTTPHEADER     => self::headers(),
        ]);

        $body   = curl_exec($ch);
        $errno  = curl_errno($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($errno !== 0 || $body === false || $status !== 200) {
            return null;
        }

        $data = json_decode((string)$body, true);
        if (!is_array($data) || !isset($data['forecast']) || !is_array($data['forecast'])) {
            return null;
        }

        return array_map('floatval', $data['forecast']);
    }

    /** Whether the forecasting service is reachable and ready. */
    public static function healthy(): bool
    {
        $ch = curl_init(self::baseUrl() . '/health');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 2,
            CURLOPT_TIMEOUT        => 3,
            CURLOPT_HTTPHEADER     => self::headers(),
        ]);
        $body   = curl_exec($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        return $status === 200 && is_string($body) && str_contains($body, 'ok');
    }
}
