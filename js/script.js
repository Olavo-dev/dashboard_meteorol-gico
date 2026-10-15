const $ = (id) => document.getElementById(id);
let chart = null;
let lastWeatherData = null;
let mqttClient = null;
let favorite = JSON.parse(localStorage.getItem("climanow-favorite") || "null");
let history = JSON.parse(localStorage.getItem("climanow-history") || "[]");

document.addEventListener("DOMContentLoaded", () => {
  applySavedTheme();
  renderHistory();
  renderFavorite();
  connectMQTT();
  $("searchForm").addEventListener("submit", (event) => {
    event.preventDefault();
    consultarClima($("cityInput").value.trim(), $("countryInput").value.trim().toUpperCase());
  });
  $("themeButton").addEventListener("click", toggleTheme);
  $("favoriteButton").addEventListener("click", saveFavorite);
  $("favoriteSearchButton").addEventListener("click", () => {
    if (favorite) consultarClima(favorite.city, favorite.country);
  });
  $("clearHistoryButton").addEventListener("click", clearHistory);
  $("publishButton").addEventListener("click", publishMQTT);
  if (APP_CONFIG.OPENWEATHER_API_KEY && APP_CONFIG.OPENWEATHER_API_KEY !== "COLE_SUA_API_KEY_AQUI") {
    consultarClima("Brotas", "BR");
  } else {
    setStatus("Configure sua API Key no arquivo js/config.js para começar.", "error");
  }
});

async function consultarClima(city, country = "") {
  if (!city) {
    setStatus("Informe uma cidade antes de realizar a consulta.", "error");
    $("cityInput").focus();
    return;
  }
  if (!APP_CONFIG.OPENWEATHER_API_KEY || APP_CONFIG.OPENWEATHER_API_KEY === "COLE_SUA_API_KEY_AQUI") {
    setStatus("Configure a API Key no arquivo js/config.js.", "error");
    return;
  }

  setStatus("Consultando dados meteorológicos...", "");
  $("searchForm").querySelector("button").disabled = true;
  try {
    const query = country ? `${city},${country}` : city;
    const currentUrl = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(query)}&appid=${APP_CONFIG.OPENWEATHER_API_KEY}&units=metric&lang=pt_br`;
    const currentResponse = await fetch(currentUrl);
    const current = await currentResponse.json();
    if (!currentResponse.ok) {
      if (current.cod === "404" || current.cod === 404) throw new Error("Cidade não encontrada. Verifique o nome informado e tente novamente.");
      if (current.cod === 401 || currentResponse.status === 401) throw new Error("Não foi possível acessar o serviço meteorológico. Verifique a configuração da API Key.");
      throw new Error(current.message || "Não foi possível consultar os dados. Tente novamente.");
    }

    const forecastUrl = `https://api.openweathermap.org/data/2.5/forecast?lat=${current.coord.lat}&lon=${current.coord.lon}&appid=${APP_CONFIG.OPENWEATHER_API_KEY}&units=metric&lang=pt_br`;
    const forecastResponse = await fetch(forecastUrl);
    const forecast = forecastResponse.ok ? await forecastResponse.json() : null;

    lastWeatherData = current;
    exibirClima(current);
    atualizarGrafico(forecast);
    saveToHistory(current);
    setStatus("Dados meteorológicos atualizados com sucesso.", "success");
  } catch (error) {
    if (error instanceof TypeError) setStatus("Não foi possível consultar os dados. Verifique sua conexão com a internet.", "error");
    else setStatus(error.message || "Ocorreu um erro ao consultar o clima.", "error");
  } finally {
    $("searchForm").querySelector("button").disabled = false;
  }
}

function exibirClima(data) {
  const cityName = data.name;
  const country = data.sys.country || "";
  const temp = Math.round(data.main.temp);
  $("currentTitle").textContent = `${cityName}, ${country}`;
  $("weatherDescription").textContent = data.weather?.[0]?.description || "Condição indisponível";
  $("temperature").textContent = temp;
  $("feelsLike").textContent = `Sensação térmica: ${Math.round(data.main.feels_like)} °C`;
  $("humidity").innerHTML = `${data.main.humidity}<small>%</small>`;
  $("wind").innerHTML = `${Math.round((data.wind?.speed || 0) * 3.6)}<small> km/h</small>`;
  $("pressure").innerHTML = `${data.main.pressure}<small> hPa</small>`;
  $("maxTemp").innerHTML = `${Math.round(data.main.temp_max)}<small>°C</small>`;
  $("minMax").textContent = `Mín. ${Math.round(data.main.temp_min)}° · Máx. ${Math.round(data.main.temp_max)}°`;
  $("sunTimes").textContent = `Nascer do sol ${formatTime(data.sys.sunrise, data.timezone)} · Pôr do sol ${formatTime(data.sys.sunset, data.timezone)}`;
  $("weatherEmoji").textContent = chooseWeatherEmoji(data.weather?.[0]?.main, data.weather?.[0]?.icon);
  $("updatedAt").textContent = `Última atualização: ${new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}`;
  $("publishButton").disabled = !(mqttClient && mqttClient.connected);
  renderFavorite();
}

function chooseWeatherEmoji(condition, iconCode = "") {
  if (condition === "Thunderstorm") return "⛈️";
  if (condition === "Drizzle" || condition === "Rain") return "🌧️";
  if (condition === "Snow") return "❄️";
  if (condition === "Mist" || condition === "Fog" || condition === "Haze") return "🌫️";
  if (condition === "Clouds") return "☁️";
  return iconCode.includes("n") ? "🌙" : "☀️";
}

function formatTime(unixSeconds, timezoneOffset) {
  if (!unixSeconds) return "--:--";
  return new Date((unixSeconds + timezoneOffset) * 1000).toLocaleTimeString("pt-BR", {
    timeZone: "UTC", hour: "2-digit", minute: "2-digit"
  });
}

function atualizarGrafico(forecast) {
  const ctx = $("forecastChart").getContext("2d");
  let labels = ["Agora", "+3h", "+6h", "+9h", "+12h"];
  let values = lastWeatherData ? [lastWeatherData.main.temp] : [0];
  if (forecast?.list?.length) {
    const nextPeriods = forecast.list.slice(0, 5);
    labels = nextPeriods.map(item => new Date(item.dt * 1000).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }));
    values = nextPeriods.map(item => Math.round(item.main.temp * 10) / 10);
  }
  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Temperatura (°C)",
        data: values,
        borderColor: "#5575ef",
        backgroundColor: "rgba(85,117,239,.13)",
        fill: true,
        tension: .38,
        borderWidth: 3,
        pointRadius: 4,
        pointBackgroundColor: "#5575ef"
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: true, labels: { usePointStyle: true, boxWidth: 8, color: getComputedStyle(document.body).getPropertyValue("--muted") } } },
      scales: {
        x: { title: { display: true, text: "Horário", color: getComputedStyle(document.body).getPropertyValue("--muted") }, grid: { display: false }, ticks: { color: getComputedStyle(document.body).getPropertyValue("--muted") } },
        y: { title: { display: true, text: "Temperatura (°C)", color: getComputedStyle(document.body).getPropertyValue("--muted") }, grid: { color: getComputedStyle(document.body).getPropertyValue("--line") }, ticks: { color: getComputedStyle(document.body).getPropertyValue("--muted") } }
      }
    }
  });
}

function saveToHistory(data) {
  const item = { city: data.name, country: data.sys.country || "", temp: Math.round(data.main.temp) };
  history = [item, ...history.filter(old => old.city !== item.city || old.country !== item.country)].slice(0, 5);
  localStorage.setItem("climanow-history", JSON.stringify(history));
  renderHistory();
}

function renderHistory() {
  const list = $("historyList");
  list.innerHTML = "";
  if (!history.length) {
    list.innerHTML = '<li class="empty-history">Suas consultas aparecerão aqui.</li>';
    return;
  }
  history.forEach(item => {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = `${item.city}, ${item.country}`;
    const temp = document.createElement("span");
    temp.className = "history-temp";
    temp.textContent = `${item.temp} °C`;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Ver";
    button.setAttribute("aria-label", `Consultar novamente ${item.city}`);
    button.addEventListener("click", () => consultarClima(item.city, item.country));
    li.append(name, temp, button);
    list.appendChild(li);
  });
}

function clearHistory() {
  history = [];
  localStorage.removeItem("climanow-history");
  renderHistory();
}

function saveFavorite() {
  if (!lastWeatherData) {
    setStatus("Consulte uma cidade antes de salvá-la como favorita.", "error");
    return;
  }
  favorite = { city: lastWeatherData.name, country: lastWeatherData.sys.country || "" };
  localStorage.setItem("climanow-favorite", JSON.stringify(favorite));
  renderFavorite();
  setStatus("Cidade favorita salva neste navegador.", "success");
}

function renderFavorite() {
  $("favoriteText").textContent = favorite ? `${favorite.city}, ${favorite.country}` : "Nenhuma cidade salva.";
  $("favoriteSearchButton").disabled = !favorite;
  $("favoriteButton").textContent = favorite && lastWeatherData && favorite.city === lastWeatherData.name ? "★ Cidade salva" : "☆ Salvar cidade atual";
}

function applySavedTheme() {
  const dark = localStorage.getItem("climanow-theme") === "dark";
  document.body.classList.toggle("dark", dark);
  $("themeButton").textContent = dark ? "☀" : "☾";
}

function toggleTheme() {
  const dark = !document.body.classList.contains("dark");
  document.body.classList.toggle("dark", dark);
  localStorage.setItem("climanow-theme", dark ? "dark" : "light");
  $("themeButton").textContent = dark ? "☀" : "☾";
  if (lastWeatherData) atualizarGrafico(null);
}

function setStatus(message, type) {
  const el = $("statusMessage");
  el.textContent = message;
  el.className = `status-message ${type || ""}`;
}

function connectMQTT() {
  try {
    if (!window.mqtt || !APP_CONFIG.MQTT_BROKER) {
      $("mqttStatus").textContent = "Biblioteca MQTT indisponível";
      $("mqttIndicator").className = "mqtt-indicator offline";
      return;
    }
    $("mqttStatus").textContent = "Conectando...";
    $("mqttIndicator").className = "mqtt-indicator connecting";
    mqttClient = mqtt.connect(APP_CONFIG.MQTT_BROKER, { connectTimeout: 5000, reconnectPeriod: 0, clientId: "climanow_" + Math.random().toString(16).slice(2, 10) });
    mqttClient.on("connect", () => {
      $("mqttStatus").textContent = "Conectado";
      $("mqttIndicator").className = "mqtt-indicator";
      $("publishButton").disabled = !lastWeatherData;
    });
    mqttClient.on("error", () => {
      $("mqttStatus").textContent = "Não conectado";
      $("mqttIndicator").className = "mqtt-indicator offline";
      $("publishButton").disabled = true;
    });
    mqttClient.on("close", () => {
      $("mqttStatus").textContent = "Desconectado";
      $("mqttIndicator").className = "mqtt-indicator offline";
      $("publishButton").disabled = true;
    });
  } catch {
    $("mqttStatus").textContent = "Não conectado";
    $("mqttIndicator").className = "mqtt-indicator offline";
  }
}

function publishMQTT() {
  if (!mqttClient?.connected || !lastWeatherData) {
    setStatus("MQTT não está conectado ou não há dados para publicar.", "error");
    return;
  }
  const payload = {
    cidade: lastWeatherData.name,
    pais: lastWeatherData.sys.country,
    temperatura_c: lastWeatherData.main.temp,
    sensacao_termica_c: lastWeatherData.main.feels_like,
    umidade_percentual: lastWeatherData.main.humidity,
    vento_kmh: Math.round((lastWeatherData.wind?.speed || 0) * 3.6),
    atualizado_em: new Date().toISOString()
  };
  mqttClient.publish(APP_CONFIG.MQTT_TOPIC, JSON.stringify(payload), { qos: 0 }, error => {
    if (error) setStatus("Falha ao publicar os dados via MQTT.", "error");
    else setStatus(`Dados publicados no tópico ${APP_CONFIG.MQTT_TOPIC}.`, "success");
  });
}
