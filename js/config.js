/*
  CONFIGURAÇÃO DO PROJETO
  1. Crie uma chave gratuita em https://openweathermap.org/api
  2. Cole sua chave entre as aspas abaixo.
  3. Para MQTT, ajuste o endereço WebSocket e o tópico conforme seu broker.
  Não publique sua chave real em repositórios públicos.
*/
const APP_CONFIG = {
  OPENWEATHER_API_KEY: "COLE_SUA_API_KEY_AQUI",
  MQTT_BROKER: "wss://test.mosquitto.org:8081",
  MQTT_TOPIC: "senai/climanow/olavo"
};
