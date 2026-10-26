const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");

const HDFULL_BASE = "https://hdfull.love";

function createAddon(userConfig) {
  const fullCookie = userConfig ? decodeURIComponent(userConfig) : "";

  const builder = new addonBuilder({
    id: "org.hdfull.personal",
    version: "1.0.3",
    name: "HDFull - Mi Cuenta",
    description: "Accede a tus series pendientes y enlaces de HDFull",
    resources: ["catalog", "stream"],
    types: ["series", "movie"],
    catalogs: [
      {
        type: "series",
        id: "hdfull_pending",
        name: "HDFull - Mis Pendientes"
      }
    ],
    idPrefixes: ["hdfull"]
  });

  // Manejador del catálogo (Pendientes)
  builder.defineCatalogHandler(async (args) => {
    if (args.id === "hdfull_pending") {
      try {
        console.log("--- Intentando conectar a HDFull con cabeceras de navegador ---");
        
        // Petición simulando un navegador real para esquivar el bloqueo 403
        const response = await axios.get(`${HDFULL_BASE}/perfil/seguimiento`, {
          headers: {
            "Cookie": fullCookie,
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
            "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
            "Referer": `${HDFULL_BASE}/`,
            "Sec-Ch-Ua": '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
            "Sec-Ch-Ua-Mobile": "?0",
            "Sec-Ch-Ua-Platform": '"Windows"',
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "same-origin",
            "Sec-Fetch-User": "?1",
            "Upgrade-Insecure-Requests": "1"
          },
          maxRedirects: 5,
          validateStatus: (status) => status >= 200 && status < 400
        });

        console.log("¡Conexión exitosa! Estado HTTP:", response.status);
        
        const $ = cheerio.load(response.data);
        const metas = [];

        $("article, .item, .show, .box, li, tr").each((i, el) => {
          const title = $(el).find(".title, h3, h4, a").first().text().trim();
          const poster = $(el).find("img").attr("src");
          
          if (title && title.length > 2 && title.length < 60 && !title.includes("HDFull") && !title.includes("Iniciar")) {
            metas.push({
              id: `hdfull:${encodeURIComponent(title)}`,
              type: "series",
              name: title,
              poster: poster && poster.startsWith("http") ? poster : `${HDFULL_BASE}${poster || ""}`
            });
          }
        });

        const uniqueMetas = Array.from(new Set(metas.map(a => a.name)))
          .map(name => metas.find(a => a.name === name));

        console.log("Total de elementos extraídos:", uniqueMetas.length);
        return { metas: uniqueMetas };

      } catch (error) {
        console.error("Error detallado al obtener pendientes de HDFull:", error.response?.status, error.message);
        return { metas: [] };
      }
    }
    return { metas: [] };
  });

  builder.defineStreamHandler(async (args) => {
    return { streams: [] };
  });

  return builder.getInterface();
}

const express = require("express");
const app = express();
const PORT = process.env.PORT || 7000;

app.get("/", (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Configurar HDFull Addon</title>
        <style>
          body { font-family: Arial; background: #121212; color: #fff; padding: 30px; text-align: center; }
          input { padding: 12px; width: 90%; max-width: 400px; border-radius: 5px; border: 1px solid #444; background: #222; color: #fff; margin-bottom: 15px; }
          button { padding: 12px 25px; background: #e50914; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: bold; font-size: 16px; }
          button:hover { background: #b80710; }
          .card { background: #1e1e1e; padding: 30px; border-radius: 10px; display: inline-block; box-shadow: 0 4px 15px rgba(0,0,0,0.5); width: 100%; max-width: 450px; box-sizing: border-box; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>Configurar Addon HDFull</h2>
          <p>Pega tu cadena de cookies completa:</p>
          <input type="text" id="cookie" placeholder="PHPSESSID=...; guid=..." /><br>
          <button onclick="instalar()">Instalar en Stremio</button>
        </div>
        <script>
          function instalar() {
            const cookie = document.getElementById('cookie').value.trim();
            if(!cookie) { alert('Introduce una cookie válida'); return; }
            const host = window.location.origin;
            const manifestUrl = host + '/' + encodeURIComponent(cookie) + '/manifest.json';
            window.location.href = 'stremio://' + manifestUrl.replace('https://','').replace('http://','');
          }
        </script>
      </body>
    </html>
  `);
});

app.get("/:config/manifest.json", (req, res) => {
  const addonInterface = createAddon(req.params.config);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.json(addonInterface.manifest);
});

app.get("/:config/:resource/:type/:id.json", async (req, res) => {
  const { config, resource, type, id } = req.params;
  const addonInterface = createAddon(config);
  
  if (resource === "catalog") {
    const result = await addonInterface.get("catalog", type, id);
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.json(result);
  }
  if (resource === "stream") {
    const result = await addonInterface.get("stream", type, id);
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.json(result);
  }
  res.status(404).send("Not found");
});

app.listen(PORT, () => {
  console.log(`Addon ejecutándose en el puerto ${PORT}`);
});
