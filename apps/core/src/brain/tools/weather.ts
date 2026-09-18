import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { config } from "../../config";

const WMO: Record<number, string> = {
  0: "céu limpo", 1: "predominantemente limpo", 2: "parcialmente nublado", 3: "nublado",
  45: "neblina", 48: "neblina com geada", 51: "garoa leve", 53: "garoa", 55: "garoa forte",
  61: "chuva leve", 63: "chuva", 65: "chuva forte", 71: "neve leve", 73: "neve", 75: "neve forte",
  80: "pancadas leves", 81: "pancadas", 82: "pancadas fortes", 95: "tempestade",
  96: "tempestade com granizo", 99: "tempestade forte com granizo",
};

interface GeoResult {
  results?: { name: string; latitude: number; longitude: number; admin1?: string; country?: string }[];
}

interface Forecast {
  current: { temperature_2m: number; apparent_temperature: number; relative_humidity_2m: number; weather_code: number; wind_speed_10m: number };
  daily: { time: string[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: number[]; weather_code: number[] };
}

export const weatherTool = betaZodTool({
  name: "get_weather",
  description: `Clima atual e previsão dos próximos dias via Open-Meteo. Se o usuário não disser cidade, usa "${config.city}".`,
  inputSchema: z.object({
    city: z.string().describe("Nome da cidade, ex: 'Curitiba' ou 'Lisboa'").optional(),
    days: z.number().int().min(1).max(7).describe("Dias de previsão (1-7)").optional(),
  }),
  run: async ({ city = config.city, days = 3 }) => {
    const geoUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
    geoUrl.searchParams.set("name", city);
    geoUrl.searchParams.set("count", "1");
    geoUrl.searchParams.set("language", "pt");
    const geo = (await (await fetch(geoUrl)).json()) as GeoResult;
    const place = geo.results?.[0];
    if (!place) return `Cidade "${city}" não encontrada.`;

    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(place.latitude));
    url.searchParams.set("longitude", String(place.longitude));
    url.searchParams.set("current", "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m");
    url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code");
    url.searchParams.set("forecast_days", String(days));
    url.searchParams.set("timezone", "auto");
    const data = (await (await fetch(url)).json()) as Forecast;

    const c = data.current;
    const daily = data.daily.time.map((date, i) => ({
      date,
      min: data.daily.temperature_2m_min[i],
      max: data.daily.temperature_2m_max[i],
      chuva: `${data.daily.precipitation_probability_max[i]}%`,
      condicao: WMO[data.daily.weather_code[i] ?? -1] ?? "desconhecido",
    }));

    return JSON.stringify({
      local: [place.name, place.admin1, place.country].filter(Boolean).join(", "),
      agora: {
        temperatura: `${c.temperature_2m}°C`,
        sensacao: `${c.apparent_temperature}°C`,
        umidade: `${c.relative_humidity_2m}%`,
        vento: `${c.wind_speed_10m} km/h`,
        condicao: WMO[c.weather_code] ?? "desconhecido",
      },
      previsao: daily,
    });
  },
});
