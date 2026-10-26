const { addonBuilder } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");
const express = require("express");

const HDFULL_BASE = "https://hdfull.love"; // Cambiar si cambia el dominio oficial

// Configuración base del Addon
function createAddon(userConfig) {
  const cookie = userConfig ? decodeURIComponent(userConfig) : "";

  const builder = new addonBuilder({
    id: "org.hdfull.personal",
    version: "1.0.0",
    name: "HDFull - Mi Cuenta",
    description: "Accede a tus series pendientes y enlaces directos de HDFull",
    resources: ["catalog", "meta", "stream"],
    types: ["series", "movie"],
    catalogs: [
      {
        type: "series",
        id: "hdfull_pending",
        name: "HDFull - Mis Pendientes"
      }
    ],
    idPrefixes: ["tt"]
  });

  // Manejador del catálogo (Pendientes)
  builder.defineCatalogHandler(async (args) => {
    if (args.id === "hdfull_pending") {
      if (!cookie) {
        console.warn("Cookie PHPSESSID no configurada");
        return { metas: [] };
      }

      try {
        // Petición a la sección de seguimiento de HDFull usando la cookie del usuario
        const response = await axios.get(`${HDFULL_BASE}/perfil/seguimiento`, {
          headers: {
            Cookie: `PHPSESSID=${cookie}`,
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
          },
          maxRedirects: 5,
          validateStatus: (status) => status >= 200 && status < 400
        });

        const $ = cheerio.load(response.data);
        const metas = [];

        // Selector HTML de los elementos pendientes en HDFull (ajustar según estructura actual)
        $(".item").each((i, el) => {
          const title = $(el).find(".title").text().trim();
          const poster = $(el).find("img").attr("src");
          const linkEl = $(el).find("a");
          const relativeUrl = linkEl.attr("href");

          // Nota: Lo ideal es mapear el título o ID de HDFull con su IMDb ID (ttXXXXXXX)
          // Stremio requiere obligatoriamente un ID con formato IMDb para mostrar carátulas oficiales.
          if (title) {
            metas.push({
              id: `hdfull:${encodeURIComponent(title)}`, // ID interno temporal
              type: "series",
              name: title,
              poster: poster || ""
            });
          }
        });

        return { metas };
      } catch (error) {
        console.error("Error al obtener pendientes de HDFull:", error.message);
        // Si es error de autenticación, avisar claramente
        if (error.response && error.response.status === 403) {
          console.error("Cookie PHPSESSID inválida o expirada");
        }
        return { metas: [] };
      }
    }
    return { metas: [] };
  });

  // Manejador de Metadatos (necesario para que Stremio muestre detalles de los items del catálogo)
  builder.defineMetaHandler(async (args) => {
    // Los IDs hdfull:* no son de IMDb, así que devolvemos metadatos básicos propios
    if (args.id.startsWith("hdfull:")) {
      try {
        const title = decodeURIComponent(args.id.replace("hdfull:", ""));

        // Buscar la ficha en HDFull para obtener más detalles
        const response = await axios.get(`${HDFULL_BASE}/busqueda?q=${encodeURIComponent(title)}`, {
          headers: {
            Cookie: `PHPSESSID=${cookie}`,
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
          },
          maxRedirects: 5,
          validateStatus: (status) => status >= 200 && status < 400
        });

        const $ = cheerio.load(response.data);
        const meta = {
          id: args.id,
          type: args.type,
          name: title,
          poster: "",
          background: "",
          posterShape: "portrait"
        };

        // Intentar extraer sinopsis, año, etc. de los resultados de búsqueda
        if ($(".result-item").length > 0) {
          meta.synopsis = $(".result-item .synopsis").text().trim() || "";
          meta.year = parseInt($(".result-item .year").text()) || undefined;
        }

        return { meta };
      } catch (error) {
        console.error("Error al obtener metadatos para:", args.id, error.message);
        // Devolver un meta mínimo válido aunque falle la búsqueda
        return {
          meta: {
            id: args.id,
            type: args.type,
            name: decodeURIComponent(args.id.replace("hdfull:", "")),
            poster: "",
            posterShape: "portrait"
          }
        };
      }
    }

    // Para IDs tipo IMDb (tt...), devolver vacío ya que no somos fuente de Cinemeta
    return { meta: null };
  });

  // Manejador de Streams (Enlaces de vídeo)
  builder.defineStreamHandler(async (args) => {
    const streams = [];

    try {
      // Si es un ID propio de HDFull, buscar el episodio/película
      if (args.id.startsWith("hdfull:")) {
        const title = decodeURIComponent(args.id.replace("hdfull:", ""));

        // Buscar en HDFull y extraer enlaces de streaming
        const searchResponse = await axios.get(`${HDFULL_BASE}/busqueda?q=${encodeURIComponent(title)}`, {
          headers: {
            Cookie: `PHPSESSID=${cookie}`,
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
          },
          maxRedirects: 5,
          validateStatus: (status) => status >= 200 && status < 400
        });

        const $search = cheerio.load(searchResponse.data);

        $search(".result-item a").each((i, el) => {
          const episodeTitle = $($search(el)).find(".ep-title").text().trim();
          const href = $($search(el)).attr("href");
          if (href && !episodeTitle.includes("Error")) {
            streams.push({
              name: `Ver en HDFull${episodeTitle ? ` - ${episodeTitle}` : ""}`,
              externalUrl: `${HDFULL_BASE}${href.startsWith("/") ? href : "/" + href}`
            });
          }
        });
      } else {
        // ID externo (IMDb), redirigir a la búsqueda de HDFull
        streams.push({
          name: "Buscar en HDFull",
          externalUrl: `${HDFULL_BASE}/busqueda?q=${encodeURIComponent(args.name || "")}`
        });
      }

    } catch (error) {
      console.error("Error al obtener streams:", error.message);
      // Fallback: enlace directo a HDFull
      if (cookie) {
        streams.push({
          name: "Ir a HDFull",
          externalUrl: `${HDFULL_BASE}`
        });
      }
    }

    return { streams };
  });

  return builder.getInterface();
}

// Servidor HTTP con Interfaz de Configuración integrada
const app = express();
const PORT = process.env.PORT || 7000;

// Ruta principal: Página de configuración para meter la cookie PHPSESSID
app.get("/", (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Configurar HDFull Addon</title>
        <style>
          body { font-family: Arial; background: #121212; color: #fff; padding: 40px; text-align: center; }
          input { padding: 10px; width: 300px; border-radius: 5px; border: 1px solid #444; background: #222; color: #fff; }
          button { padding: 10px 20px; background: #e50914; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: bold; }
          button:hover { background: #b80710; }
          .card { background: #1e1e1e; padding: 30px; border-radius: 10px; display: inline-block; box-shadow: 0 4px 15px rgba(0,0,0,0.5); }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>Configurar Addon HDFull</h2>
          <p>Introduce tu cookie <b>PHPSESSID</b> de sesión de HDFull:</p>
          <input type="text" id="cookie" placeholder="Ej: abc123xyz789..." /><br><br>
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

// Rutas dinámicas basadas en la configuración del usuario
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
    try {
      const result = await addonInterface.get("catalog", type, id);
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.json(result);
    } catch (err) {
      console.error("Error en catálogo:", err.message);
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.json({ metas: [] });
    }
  }

  if (resource === "meta") {
    try {
      const result = await addonInterface.get("meta", type, id);
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.json(result);
    } catch (err) {
      console.error("Error en metadatos:", err.message);
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.json({ meta: null });
    }
  }

  if (resource === "stream") {
    try {
      const result = await addonInterface.get("stream", type, id);
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.json(result);
    } catch (err) {
      console.error("Error en streams:", err.message);
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.json({ streams: [] });
    }
  }

  res.status(404).send("Not found");
});

app.listen(PORT, () => {
  console.log(`Addon ejecutándose en el puerto ${PORT}`);
});
