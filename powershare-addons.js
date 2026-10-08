// ==UserScript==
// @name         Powershare Addons
// @namespace    http://tampermonkey.net/
// @version      2026-10-07.3
// @description  Add some functionality to powershare
// @author       https://github.com/ErnyDV
// @match        https://www1.nuancepowershare.com/*
// @icon         data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const paths = {
        advancedImagesSearch: '/smr/work/search/showSearch.action',
        pacs: '/smr/work/pacs/view.action',
    };

    // Column positions in #pacs-table, counted 1-10 from the first <td>
    const COL = {
        images: 2,
        name: 7,
        dob: 8,
        modality: 9,
        description: 10,
    };

    // ---------- helpers ----------

    function capitalizeName(name) {
        return name.split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(' ');
    }

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function cleanText(el) {
        return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
    }

    // ---------- reading the selected rows ----------

    // Reads every selected row in #pacs-table of the given document
    function readSelectedExams(doc) {
        const table = doc.getElementById('pacs-table');
        if (!table) return [];

        const exams = [];
        table.querySelectorAll('tbody tr.row_selected').forEach(row => {
            const cells = row.querySelectorAll(':scope > td');
            const cell = n => cells[n - 1]; // 1-based

            const imageEl = cell(COL.images) ? (cell(COL.images).querySelector('.image-count') || cell(COL.images)) : null;
            const imageMatch = cleanText(imageEl).match(/\d[\d,]*/);

            exams.push({
                name: cleanText(cell(COL.name)),
                dob: cleanText(cell(COL.dob)),
                // "MODALITY DESCRIPTION" — the description can be empty, so modality alone still shows
                description: [cleanText(cell(COL.modality)), cleanText(cell(COL.description))]
                    .filter(Boolean)
                    .join(' '),
                images: imageMatch ? parseInt(imageMatch[0].replace(/,/g, ''), 10) : null,
            });
        });
        return exams;
    }

    // The popup iframe is on the same site, so it can read the PACS page behind it
    function readFromParent() {
        try {
            if (window.parent && window.parent !== window) {
                return readSelectedExams(window.parent.document);
            }
        } catch (e) { /* not accessible */ }
        return [];
    }

    // ---------- grouping ----------

    // One entry per patient: same name + same DOB = same patient
    function groupByPatient(exams) {
        const patients = {};

        exams.forEach(exam => {
            const key = exam.name.toLowerCase() + '|' + exam.dob;
            if (!patients[key]) {
                patients[key] = { name: exam.name, dob: exam.dob, exams: [] };
            }
            patients[key].exams.push(exam);
        });

        return Object.values(patients).sort((a, b) => a.name.localeCompare(b.name));
    }

    // ---------- print window ----------

    function printSelectedExams() {
        const patients = groupByPatient(readFromParent());

        if (!patients.length) {
            alert("Couldn't read the selected exams. The PACS page layout may have changed.");
            return;
        }

        let grandTotal = 0;
        let examCount = 0;

        const blocks = patients.map(p => {
            const total = p.exams.reduce((sum, e) => sum + (e.images || 0), 0);
            grandTotal += total;
            examCount += p.exams.length;

            const rows = p.exams.map(e => `
                <tr>
                    <td>${escapeHtml(e.description)}</td>
                    <td class="num">${e.images === null ? '&mdash;' : e.images.toLocaleString()}</td>
                </tr>`).join('');

            return `
                <table class="patient">
                    <thead>
                        <tr><th colspan="2" class="name">${escapeHtml(capitalizeName(p.name))}</th></tr>
                        <tr><th colspan="2" class="dob">DOB: ${escapeHtml(p.dob)}</th></tr>
                        <tr class="cols"><th>Exam</th><th class="num">Images</th></tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>`;
        }).join('');

        const printCss = `
                        body {
                            font-family: sans-serif;
                            font-size: 0.85rem;
                            margin: 0;
                            padding: 20px;
                        }
                        .wrap { max-width: 480px; margin: 0 auto; }
                        .summary { text-align: center; margin-bottom: 14px; color: #444; }
                        table.patient {
                            border-collapse: collapse;
                            width: 100%;
                            margin-bottom: 16px;
                            font-size: 0.8rem;
                            page-break-inside: avoid;
                            break-inside: avoid;
                        }
                        th, td { border: 1px solid #999; padding: 4px 8px; text-align: left; }
                        th.name {
                            background-color: #333;
                            color: #fff;
                            font-size: 0.95rem;
                            text-align: center;
                        }
                        th.dob {
                            background-color: #ddd;
                            font-weight: normal;
                            text-align: center;
                        }
                        tr.cols th { background-color: #f2f2f2; font-size: 0.75rem; }
                        .num { text-align: right; width: 70px; }
                        tbody tr:nth-child(even) td { background-color: #fafafa; }
                        .print-btn { display: block; margin: 16px auto 0; padding: 6px 18px; }

                        @media print {
                            body { padding: 0; }
                            * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                            th, td { border: 1px solid #000; }
                            .print-btn { display: none; }
                        }`;

        // No <style> tag and no onclick: Powershare's Content Security Policy
        // carries over to the pop-up and blocks both. Styles are applied below instead.
        const printContent = `
            <html>
                <head>
                    <title>Nominations</title>
                </head>
                <body>
                    <div class="wrap">
                        <div class="summary">
                            ${patients.length} patient${patients.length === 1 ? '' : 's'} &middot;
                            ${examCount} exam${examCount === 1 ? '' : 's'} &middot;
                            ${grandTotal.toLocaleString()} images
                        </div>
                        ${blocks}
                        <button class="print-btn">Print</button>
                    </div>
                </body>
            </html>`;

        const printWindow = window.open('', '_blank');
        if (!printWindow) {
            alert('Pop-up blocked. Allow pop-ups for Powershare to print.');
            return;
        }
        printWindow.document.write(printContent);
        printWindow.document.close();

        applyStyles(printWindow, printCss);

        const btn = printWindow.document.querySelector('.print-btn');
        if (btn) {
            btn.addEventListener('click', function () {
                printWindow.print();
                printWindow.close();
            });
        }
    }

    // Adds CSS to the pop-up in a way the page's CSP allows
    function applyStyles(win, css) {
        const doc = win.document;

        // 1) Constructed stylesheet: built through the CSSOM, which CSP doesn't block
        try {
            const sheet = new win.CSSStyleSheet();
            sheet.replaceSync(css);
            doc.adoptedStyleSheets = [sheet];
            return;
        } catch (e) { /* older browser, try the next option */ }

        // 2) Reuse the page's own nonce so a <style> tag is allowed
        try {
            const nonced = document.querySelector('[nonce]');
            const nonce = nonced && (nonced.nonce || nonced.getAttribute('nonce'));
            if (nonce) {
                const style = doc.createElement('style');
                style.nonce = nonce;
                style.textContent = css;
                doc.head.appendChild(style);
            }
        } catch (e) { /* nothing else to try */ }
    }

    // ---------- PACS list page ----------

    function selectAllLink() {
        const actions = document.getElementById('defaultList');
        if (!actions) return;

        const newLi = document.createElement('li');
        const newLink = document.createElement('a');
        newLink.textContent = 'Select All';
        newLink.id = 'selectallLink';
        newLink.style.cursor = 'pointer';
        newLi.appendChild(newLink);
        actions.appendChild(newLi);

        newLink.addEventListener('click', function () {
            const table = document.getElementById('pacs-table');
            if (!table) return;
            table.querySelectorAll('input').forEach(input => input.click());
        });
    }

    // ---------- Push to PACS popup (iframe) ----------

    function addPrintButton() {
        const btnBlock = document.querySelector('#btnBlock');
        if (!btnBlock) return;

        // Original position: inside #btnBlock next to Push to PACS / Cancel
        const printBtn = document.createElement('a');
        printBtn.classList.add('btn', 'btn-primary');
        printBtn.style.marginLeft = '600px';
        printBtn.textContent = 'Print';
        printBtn.addEventListener('click', function () {
            printSelectedExams();
        });

        btnBlock.appendChild(printBtn);
    }

    // ---------- routing ----------

    const path = location.pathname;

    if (path === paths.pacs) {
        selectAllLink();
    } else if (path === paths.advancedImagesSearch) {
        // Allow typing in the date of birth field
        const searchValue3 = document.getElementById('searchValue3');
        if (searchValue3) {
            searchValue3.addEventListener('click', function () {
                searchValue3.readOnly = false;
            });
        }
    } else {
        addPrintButton();
    }
})();
