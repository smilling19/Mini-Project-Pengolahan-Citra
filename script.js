document.addEventListener('DOMContentLoaded', () => {
    // --- Elements ---
    const srcInput = document.getElementById('srcImageInput');
    const refInput = document.getElementById('refImageInput');
    const srcUploadArea = document.getElementById('srcUploadArea');
    const refUploadArea = document.getElementById('refUploadArea');

    const srcPreview = document.getElementById('srcPreview');
    const refPreview = document.getElementById('refPreview');
    const outPreview = document.getElementById('outPreview');

    const srcPlaceholder = document.getElementById('srcPlaceholder');
    const refPlaceholder = document.getElementById('refPlaceholder');
    const outPlaceholder = document.getElementById('outPlaceholder');

    const processBtn = document.getElementById('processBtn');
    const showStepsBtn = document.getElementById('showStepsBtn');
    const resetBtn = document.getElementById('resetBtn');

    const hiddenCanvas = document.getElementById('hiddenCanvas');
    const ctx = hiddenCanvas.getContext('2d', { willReadFrequently: true });

    const educationPanel = document.getElementById('educationPanel');
    const dynamicResultExplanation = document.getElementById('dynamicResultExplanation');
    const accordionItems = document.querySelectorAll('.accordion-item');

    // Chart instances
    let srcChartInstance = null;
    let refChartInstance = null;
    let outChartInstance = null;

    // Data stoarge
    let srcData = null; // { width, height, pixels: []}
    let refData = null;
    let computationDetails = null; // Store for calculation steps
    let srcFileName = "Source Image";
    let refFileName = "Target Image";

    // Modal elements
    const stepsModal = document.getElementById('stepsModal');
    const stepsModalBody = document.getElementById('stepsModalBody');
    const closeModalBtn = document.getElementById('closeModalBtn');

    // --- Utils ---

    // Konversi Data URL -> Image Object
    const loadImage = (dataUrl) => {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.src = dataUrl;
        });
    };

    // Ambil grayscale pixel array dari Image
    const getGrayscalePixels = (img) => {
        hiddenCanvas.width = img.width;
        hiddenCanvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, img.width, img.height);
        const data = imageData.data;
        const grayPixels = new Uint8Array(img.width * img.height);

        let j = 0;
        for (let i = 0; i < data.length; i += 4) {
            // Luma (Rec. 601) formula
            const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
            grayPixels[j++] = gray;
        }
        return {
            width: img.width,
            height: img.height,
            pixels: grayPixels
        };
    };

    // Hitung Histogram
    const calcHistogram = (pixels) => {
        const hist = new Array(256).fill(0);
        for (let i = 0; i < pixels.length; i++) {
            hist[pixels[i]]++;
        }
        return hist;
    };

    // Hitung CDF
    const calcCDF = (hist, totalPixels) => {
        const cdf = new Array(256).fill(0);
        cdf[0] = hist[0];
        for (let i = 1; i < 256; i++) {
            cdf[i] = cdf[i - 1] + hist[i];
        }
        // Normalisasi 0-255
        const cdfMin = cdf.find(val => val > 0) || 1;
        const cdfNorm = new Array(256).fill(0);
        for (let i = 0; i < 256; i++) {
            cdfNorm[i] = Math.round(((cdf[i] - cdfMin) / (totalPixels - cdfMin)) * 255);
            if (cdfNorm[i] < 0) cdfNorm[i] = 0;
        }
        return cdfNorm;
    };

    // Hitung Statistik Dasar
    const calcStats = (pixels) => {
        let min = 255;
        let max = 0;
        let sum = 0;
        for (let i = 0; i < pixels.length; i++) {
            let v = pixels[i];
            if (v < min) min = v;
            if (v > max) max = v;
            sum += v;
        }
        return {
            min: min,
            max: max,
            mean: (sum / pixels.length).toFixed(2)
        };
    };

    // Update Stats UI
    const updateStatsUI = (id, stats) => {
        const el = document.getElementById(id);
        el.innerHTML = `
            <div class="stat-item"><span>Min:</span> <span>${stats.min}</span></div>
            <div class="stat-item"><span>Max:</span> <span>${stats.max}</span></div>
            <div class="stat-item"><span>Mean:</span> <span>${stats.mean}</span></div>
        `;
    };

    // Render Chart
    const renderChart = (canvasId, chartInstance, histData, color, title) => {
        const ctxChart = document.getElementById(canvasId).getContext('2d');
        if (chartInstance) {
            chartInstance.destroy();
        }

        const labels = Array.from({ length: 256 }, (_, i) => i);

        return new Chart(ctxChart, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: title,
                    data: histData,
                    backgroundColor: color,
                    borderWidth: 0,
                    barPercentage: 1.0,
                    categoryPercentage: 1.0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 800, easing: 'easeOutQuart' },
                scales: {
                    x: {
                        display: true,
                        ticks: {
                            autoSkip: false,
                            maxRotation: 0,
                            color: '#94A3B8',
                            callback: function (val, index) {
                                return (index % 50 === 0) ? index : null;
                            }
                        },
                        grid: { display: false, drawBorder: false }
                    },
                    y: {
                        display: false,
                        beginAtZero: true
                    }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: { enabled: false }
                }
            }
        });
    };

    // Pindah Step Accordion
    const activateStep = (stepNumber) => {
        accordionItems.forEach(item => {
            if (item.dataset.step == stepNumber) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });
    };

    // Event Handlers for UI
    const checkReady = () => {
        if (srcPreview.src && refPreview.src && srcPreview.src !== window.location.href && refPreview.src !== window.location.href) {
            processBtn.disabled = false;
        } else {
            processBtn.disabled = true;
        }
    };

    const handleFile = (file, previewEl, placeholderEl, uploadArea) => {
        if (!file || !file.type.startsWith('image/')) return;

        if (previewEl.id === 'srcPreview') srcFileName = file.name;
        if (previewEl.id === 'refPreview') refFileName = file.name;

        const reader = new FileReader();
        reader.onload = (e) => {
            previewEl.src = e.target.result;
            previewEl.hidden = false;
            placeholderEl.hidden = true;
            uploadArea.classList.add('has-file');
            uploadArea.querySelector('.upload-text').textContent = file.name;
            checkReady();

            // Reset previous computation state to avoid confusion
            showStepsBtn.classList.add('hidden');
            computationDetails = null;

            outPreview.hidden = true;
            outPreview.src = '';
            outPlaceholder.hidden = false;
            outPlaceholder.textContent = "Tekan Proses untuk update";

            // Optionally clear the text explanation
            educationPanel.classList.add('hidden');

            // Clear specifically Output chart if needed
            if (outChartInstance) {
                outChartInstance.destroy();
                outChartInstance = null;
            }
            document.getElementById('outStats').innerHTML = '';
        };
        reader.readAsDataURL(file);
    };

    // Drag and Drop
    [srcUploadArea, refUploadArea].forEach(area => {
        area.addEventListener('dragover', (e) => {
            e.preventDefault();
            area.classList.add('dragover');
        });
        area.addEventListener('dragleave', () => {
            area.classList.remove('dragover');
        });
    });

    srcUploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        srcUploadArea.classList.remove('dragover');
        if (e.dataTransfer.files.length) {
            srcInput.files = e.dataTransfer.files;
            handleFile(e.dataTransfer.files[0], srcPreview, srcPlaceholder, srcUploadArea);
        }
    });

    refUploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        refUploadArea.classList.remove('dragover');
        if (e.dataTransfer.files.length) {
            refInput.files = e.dataTransfer.files;
            handleFile(e.dataTransfer.files[0], refPreview, refPlaceholder, refUploadArea);
        }
    });

    srcInput.addEventListener('change', (e) => {
        if (e.target.files.length) handleFile(e.target.files[0], srcPreview, srcPlaceholder, srcUploadArea);
    });

    refInput.addEventListener('change', (e) => {
        if (e.target.files.length) handleFile(e.target.files[0], refPreview, refPlaceholder, refUploadArea);
    });

    // Accordion Click
    accordionItems.forEach(item => {
        item.querySelector('.accordion-header').addEventListener('click', () => {
            activateStep(item.dataset.step);
        });
    });

    // Reset
    resetBtn.addEventListener('click', () => {
        srcInput.value = '';
        refInput.value = '';
        srcPreview.src = ''; srcPreview.hidden = true;
        refPreview.src = ''; refPreview.hidden = true;
        outPreview.src = ''; outPreview.hidden = true;

        srcPlaceholder.hidden = false;
        refPlaceholder.hidden = false;
        outPlaceholder.hidden = false;
        outPlaceholder.textContent = "Menunggu Proses...";

        srcUploadArea.classList.remove('has-file');
        refUploadArea.classList.remove('has-file');
        srcUploadArea.querySelector('.upload-text').textContent = "Klik atau Drag Gambar Input";
        refUploadArea.querySelector('.upload-text').textContent = "Klik atau Drag Gambar Target";

        if (srcChartInstance) srcChartInstance.destroy();
        if (refChartInstance) refChartInstance.destroy();
        if (outChartInstance) outChartInstance.destroy();

        document.getElementById('srcStats').innerHTML = '';
        document.getElementById('refStats').innerHTML = '';
        document.getElementById('outStats').innerHTML = '';

        educationPanel.classList.add('hidden');
        processBtn.disabled = true;
        showStepsBtn.classList.add('hidden');
        computationDetails = null;
    });

    // Process Histogram Specification
    processBtn.addEventListener('click', async () => {
        // UI Loading State
        const btnText = processBtn.querySelector('.btn-text');
        const loader = processBtn.querySelector('.loader');
        processBtn.disabled = true;
        btnText.style.opacity = '0.5';
        loader.classList.remove('hidden');
        outPlaceholder.textContent = "Sedang Memproses...";
        outPlaceholder.hidden = false;
        outPreview.hidden = true;
        educationPanel.classList.remove('hidden');

        // Allow UI to render loading state before heavy computation
        await new Promise(r => setTimeout(r, 50));

        activateStep(1);

        try {
            const srcImg = await loadImage(srcPreview.src);
            const refImg = await loadImage(refPreview.src);

            const srcData = getGrayscalePixels(srcImg);
            const refData = getGrayscalePixels(refImg);

            // Tampilkan Grayscale pada Preview asli dengan mengganti gambarnya ke versi abu-abu
            // (Opsional, agar user melihat bahwa kita beroperasi di grayscale)

            // 2. Histogram
            activateStep(2);
            const srcHist = calcHistogram(srcData.pixels);
            const refHist = calcHistogram(refData.pixels);

            // 3. CDF
            activateStep(3);
            const srcTotal = srcData.width * srcData.height;
            const refTotal = refData.width * refData.height;

            const srcCdfNorm = calcCDF(srcHist, srcTotal);
            const refCdfNorm = calcCDF(refHist, refTotal);

            // 4. Matching: mapping array
            activateStep(4);
            const mapArray = new Array(256).fill(0);
            for (let i = 0; i < 256; i++) {
                let j = 0;
                // Cari index j dimana CDF target mendekati CDF source[i]
                while (j < 256 && refCdfNorm[j] < srcCdfNorm[i]) {
                    j++;
                }
                mapArray[i] = j > 255 ? 255 : j;
            }

            // Apply Map to Grayscale pixels for chart stats
            const outPixels = new Uint8Array(srcData.pixels.length);
            for (let i = 0; i < srcData.pixels.length; i++) {
                outPixels[i] = mapArray[srcData.pixels[i]];
            }

            // Generate Output Image (Preserving Color)
            hiddenCanvas.width = srcData.width;
            hiddenCanvas.height = srcData.height;
            ctx.drawImage(srcImg, 0, 0);
            const originalSrcData = ctx.getImageData(0, 0, srcData.width, srcData.height);

            const outImageData = ctx.createImageData(srcData.width, srcData.height);
            for (let i = 0; i < srcData.pixels.length; i++) {
                const oldLuma = srcData.pixels[i];
                const newLuma = outPixels[i];

                const r = originalSrcData.data[i * 4];
                const g = originalSrcData.data[i * 4 + 1];
                const b = originalSrcData.data[i * 4 + 2];

                if (oldLuma === 0) {
                    // Jika warna asli hitam solid tapi dipetakan ke tingkat abu-abu tertentu
                    outImageData.data[i * 4] = newLuma;
                    outImageData.data[i * 4 + 1] = newLuma;
                    outImageData.data[i * 4 + 2] = newLuma;
                } else {
                    // Skalakan warna RGB dengan rasio kecerahan (luminance) untuk mempertahankan warna
                    const ratio = newLuma / oldLuma;
                    outImageData.data[i * 4] = Math.min(255, r * ratio);
                    outImageData.data[i * 4 + 1] = Math.min(255, g * ratio);
                    outImageData.data[i * 4 + 2] = Math.min(255, b * ratio);
                }
                outImageData.data[i * 4 + 3] = 255;   // A
            }
            ctx.putImageData(outImageData, 0, 0);
            const outDataUrl = hiddenCanvas.toDataURL();

            // Set Out Preview
            outPreview.src = outDataUrl;
            outPreview.hidden = false;
            outPlaceholder.hidden = true;

            // 5. Final Stats & Charts
            activateStep(5);
            const outHist = calcHistogram(outPixels);

            srcChartInstance = renderChart('srcChart', srcChartInstance, srcHist, '#2563EB', 'Source');
            refChartInstance = renderChart('refChart', refChartInstance, refHist, '#94A3B8', 'Target');
            outChartInstance = renderChart('outChart', outChartInstance, outHist, '#7C3AED', 'Output');

            const srcStats = calcStats(srcData.pixels);
            const refStats = calcStats(refData.pixels);
            const outStats = calcStats(outPixels);

            updateStatsUI('srcStats', srcStats);
            updateStatsUI('refStats', refStats);
            updateStatsUI('outStats', outStats);

            computationDetails = {
                srcHist: srcHist,
                refHist: refHist,
                srcCdfNorm: srcCdfNorm,
                refCdfNorm: refCdfNorm,
                mapArray: mapArray,
                totalSrc: srcTotal,
                totalRef: refTotal,
                srcName: srcFileName,
                refName: refFileName
            };
            showStepsBtn.classList.remove('hidden');

            // Dynamic Explanation
            let diffMean = parseFloat(outStats.mean) - parseFloat(srcStats.mean);
            let brightText = diffMean > 0 ? "lebih terang" : "lebih gelap";
            let intensityChange = Math.abs(diffMean).toFixed(2);

            dynamicResultExplanation.innerHTML = `
                Berhasil! Citra hasil kini mengikuti distribusi dari citra target. 
                <br><br>
                <b>Analisis Otomatis:</b> Rata-rata intensitas piksel berubah dari <b>${srcStats.mean}</b> menjadi <b>${outStats.mean}</b> (selisih ${intensityChange}). 
                Citra source menjadi <b>${brightText}</b> karena histogram target mendominasi di area tersebut dibandingkan source aslinya.
            `;

        } catch (err) {
            console.error(err);
            alert("Terjadi kesalahan saat memproses gambar.");
        } finally {
            // Revert Button
            btnText.style.opacity = '1';
            loader.classList.add('hidden');
            processBtn.disabled = false;
        }
    });

    // Expand accordion step 1 by default
    activateStep(1);

    // Modal Interaction
    showStepsBtn.addEventListener('click', () => {
        if (!computationDetails) return;

        let html = '';
        let prSum = 0;
        let pzSum = 0;

        html += `<div class="steps-grid">`;

        // --- Step 1: Source Equalization ---
        html += `
            <div>
                <h3 style="margin-bottom:0.5rem;font-size:1rem;color:var(--text-primary);">1. Histogram Equalisasi Citra Awal (${computationDetails.srcName})</h3>
                <div class="calc-table-container" style="max-height: 400px;">
                    <table class="calc-table">
                        <thead>
                            <tr>
                                <th>k</th>
                                <th>r<sub>k</sub></th>
                                <th>n<sub>k</sub></th>
                                <th>P<sub>r</sub>(r<sub>k</sub>)</th>
                                <th>CDF</th>
                                <th>s<sub>k</sub></th>
                            </tr>
                        </thead>
                        <tbody>
        `;
        for (let k = 0; k < 256; k++) {
            if (computationDetails.srcHist[k] > 0 || k === 0 || k === 255) {
                let pr = computationDetails.srcHist[k] / computationDetails.totalSrc;
                prSum += pr;
                let sk = computationDetails.srcCdfNorm[k];
                html += `<tr>
                    <td>${k}</td>
                    <td>${k}/255</td>
                    <td>${computationDetails.srcHist[k]}</td>
                    <td>${pr.toFixed(3)}</td>
                    <td>${Math.min(1, prSum).toFixed(3)}</td>
                    <td>${sk}</td>
                </tr>`;
            }
        }
        html += `</tbody></table></div></div>`;

        // --- Step 2: Target Equalization ---
        html += `
            <div>
                <h3 style="margin-bottom:0.5rem;font-size:1rem;color:var(--text-primary);">2. Histogram Equalisasi Citra Target (${computationDetails.refName})</h3>
                <div class="calc-table-container" style="max-height: 400px;">
                    <table class="calc-table">
                        <thead>
                            <tr>
                                <th>k</th>
                                <th>z<sub>k</sub></th>
                                <th>n<sub>k</sub></th>
                                <th>P<sub>z</sub>(z<sub>k</sub>)</th>
                                <th>CDF</th>
                                <th>v<sub>k</sub></th>
                            </tr>
                        </thead>
                        <tbody>
        `;
        for (let k = 0; k < 256; k++) {
            if (computationDetails.refHist[k] > 0 || k === 0 || k === 255) {
                let pz = computationDetails.refHist[k] / computationDetails.totalRef;
                pzSum += pz;
                let vk = computationDetails.refCdfNorm[k];
                html += `<tr>
                    <td>${k}</td>
                    <td>${k}/255</td>
                    <td>${computationDetails.refHist[k]}</td>
                    <td>${pz.toFixed(3)}</td>
                    <td>${Math.min(1, pzSum).toFixed(3)}</td>
                    <td>${vk}</td>
                </tr>`;
            }
        }
        html += `</tbody></table></div></div></div>`;

        // --- Step 3: Mapping / Dissemination ---
        html += `
            <div style="margin-top:0.5rem;">
                <h3 style="margin-bottom:0.5rem;font-size:1rem;color:var(--text-primary);">3. Pemetaan & Penyebaran Piksel (Transformasi z = G<sup>-1</sup>(s))</h3>
                <p style="font-size:0.85rem; color:var(--text-secondary); margin-bottom:0.5rem;">Memetakan dari <strong>Citra Awal (${computationDetails.srcName})</strong> ke <strong>Citra Target (${computationDetails.refName})</strong>.</p>
                <div class="calc-table-container" style="max-height: 500px;">
                    <table class="calc-table">
                        <thead>
                            <tr>
                                <th>r<sub>k</sub> (Asal)</th>
                                <th>s<sub>k</sub> (Citra Awal)</th>
                                <th>z<sub>k</sub> (Terpilih/Target)</th>
                                <th>v<sub>k</sub> (Citra Target)</th>
                                <th>Jumlah Piksel Mapan</th>
                            </tr>
                        </thead>
                        <tbody>
        `;

        for (let k = 0; k < 256; k++) {
            if (computationDetails.srcHist[k] > 0) {
                let sk = computationDetails.srcCdfNorm[k];
                let zk = computationDetails.mapArray[k];
                let vk = computationDetails.refCdfNorm[zk];

                html += `<tr>
                    <td>${k}/255</td>
                    <td>${sk}</td>
                    <td>${zk}/255</td>
                    <td>${vk}</td>
                    <td>${computationDetails.srcHist[k]}</td>
                </tr>`;
            }
        }
        html += `</tbody></table></div></div>`;

        stepsModalBody.innerHTML = html;
        stepsModal.classList.remove('hidden');
    });

    closeModalBtn.addEventListener('click', () => {
        stepsModal.classList.add('hidden');
    });

    window.addEventListener('click', (e) => {
        if (e.target === stepsModal) {
            stepsModal.classList.add('hidden');
        }
    });
});
