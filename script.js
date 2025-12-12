// Configuración del Worker de PDF.js (Esencial para que funcione)
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// Elementos del DOM
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const uploadCard = document.getElementById('uploadCard');
const statusCard = document.getElementById('statusCard');
const resultCard = document.getElementById('resultCard');
const logArea = document.getElementById('logArea');
const statusTitle = document.getElementById('statusTitle');
const loadingSpinner = document.getElementById('loadingSpinner');

// --- Eventos de Drag & Drop ---
// --- Eventos de Drag & Drop ---

// 1. MODIFICACIÓN AQUÍ: Controlamos el clic para evitar conflictos
dropZone.addEventListener('click', (e) => {
    // Si el clic vino del botón (o del icono dentro del botón), 
    // detenemos esta función porque el botón ya tiene su propio 'onclick' en el HTML.
    if (e.target.closest('button')) {
        return;
    }
    fileInput.click();
});

// El resto de tus eventos se quedan igual...
dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const files = e.dataTransfer.files;
    if (files.length > 0) handleFile(files[0]);
});

fileInput.addEventListener('change', (e) => {
    if (fileInput.files.length > 0) handleFile(fileInput.files[0]);
});

// --- Lógica Principal ---

function handleFile(file) {
    if (file.type !== 'application/pdf') {
        alert('Por favor, sube solo archivos PDF.');
        return;
    }
    
    // Cambiar interfaz
    uploadCard.classList.add('d-none');
    statusCard.classList.remove('d-none');
    log("Iniciando procesamiento de: " + file.name);
    
    procesarPDF(file);
}

function log(text) {
    logArea.innerHTML += `> ${text}<br>`;
    logArea.scrollTop = logArea.scrollHeight;
}

// Lógica de Negocio (Tu algoritmo original portado a JS)
function esMonto(texto) {
    if (!texto) return false;
    let s = texto.replace(/,/g, '').replace(/\$/g, '').trim();
    if (isNaN(parseFloat(s))) return false;
    return /\d/.test(s);
}

function calcularMediana(values) {
    if (values.length === 0) return 0;
    values.sort((a, b) => a - b);
    const mid = Math.floor(values.length / 2);
    return values.length % 2 !== 0 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}

async function procesarPDF(file) {
    try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
        
        let filasCrudas = [];
        let coordsDebitos = [];
        let coordsCreditos = [];

        log(`PDF cargado. Total páginas: ${pdf.numPages}`);

        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            log(`Analizando página ${i}...`);

            // Agrupación visual
            let lines = {};
            const items = textContent.items.map(item => ({
                text: item.str,
                x: item.transform[4],
                y: item.transform[5]
            }));

            items.forEach(w => {
                const yRounded = Math.round(w.y / 3) * 3;
                if (!lines[yRounded]) lines[yRounded] = [];
                lines[yRounded].push(w);
            });

            // Ordenar líneas de arriba hacia abajo (Y descendente)
            const yKeys = Object.keys(lines).map(Number).sort((a, b) => b - a);

            for (const y of yKeys) {
                let lineWords = lines[y].sort((a, b) => a.x - b.x);
                lineWords = lineWords.filter(w => w.text.trim() !== "");
                if (lineWords.length === 0) continue;

                const txtIdRaw = lineWords[0].text;
                const txtMonto = lineWords[lineWords.length - 1].text;

                if (esMonto(txtMonto)) {
                    const primerChar = txtIdRaw.trim().charAt(0);
                    const valX = lineWords[lineWords.length - 1].x;

                    if (['1', '5', '6'].includes(primerChar)) coordsDebitos.push(valX);
                    else if (['2', '3', '4'].includes(primerChar)) coordsCreditos.push(valX);

                    const descWords = lineWords.slice(1, -1);
                    const descStr = descWords.map(w => w.text).join(" ");

                    filasCrudas.push({
                        "Cuenta_Original": txtIdRaw,
                        "Cuenta_Limpia": txtIdRaw.replace(/-/g, '').replace(/,/g, '').trim(),
                        "Descripción": descStr,
                        "Monto_Texto": txtMonto,
                        "X": valX
                    });
                }
            }
        }

        // Calcular cortes
        let puntoCorte = 0;
        if (coordsDebitos.length === 0 || coordsCreditos.length === 0) {
            log("Advertencia: Usando mediana simple.");
            const todasX = filasCrudas.map(f => f.X);
            puntoCorte = calcularMediana(todasX);
        } else {
            const medDeb = calcularMediana(coordsDebitos);
            const medCred = calcularMediana(coordsCreditos);
            puntoCorte = (medDeb + medCred) / 2;
            log(`Calibración exitosa. Punto de corte X: ${puntoCorte.toFixed(2)}`);
        }

        // Generar Data
        let dataFinal = [];
        filasCrudas.forEach(f => {
            if (f.Cuenta_Original.includes("Page") || f.Cuenta_Original.includes("Fecha")) return;

            let val = 0.0;
            try { val = parseFloat(f.Monto_Texto.replace(/,/g, '')); } catch(e) {}

            let debito = 0.0;
            let credito = 0.0;

            if (f.X < puntoCorte) debito = val;
            else credito = val;

            dataFinal.push({
                "Cuenta_Original": f.Cuenta_Original,
                "Cuenta_Limpia": f.Cuenta_Limpia,
                "Descripción": f.Descripción,
                "Débito": debito !== 0 ? debito : null,
                "Crédito": credito !== 0 ? credito : null
            });
        });

        log(`Filas extraídas: ${dataFinal.length}`);
        exportarExcel(dataFinal, file.name);

        // UI de Éxito
        setTimeout(() => {
            statusCard.classList.add('d-none');
            resultCard.classList.remove('d-none');
        }, 1000);

    } catch (error) {
        console.error(error);
        log("ERROR CRÍTICO: " + error.message);
        statusTitle.textContent = "Error en el proceso";
        statusTitle.classList.add("text-danger");
        loadingSpinner.classList.add("d-none");
    }
}

function exportarExcel(data, originalName) {
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Resultado");
    const finalName = `Resultado_${originalName.replace('.pdf', '')}.xlsx`;
    XLSX.writeFile(wb, finalName);
    log("Archivo generado y descargando...");
}