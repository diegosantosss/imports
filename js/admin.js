'use strict';

const repository = '/repos/diegosantosss/imports';
const start = '<!-- catalog:start -->';
const end = '<!-- catalog:end -->';
const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const byId = (id) => document.getElementById(id);
const login = byId('login');
const editor = byId('editor');
const product = byId('product');
const photo = byId('photo');
const preview = byId('preview');

let token = '';
let snapshot;
let previewUrl;

function status(message) {
  byId('status').textContent = message;
}

async function github(path, method = 'GET', body) {
  const response = await fetch('https://api.github.com' + path, {
    method,
    redirect: 'error',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const messages = {
      401: 'Token inválido ou expirado. Saia e entre com um novo token.',
      403: 'O GitHub bloqueou a operação. Confira a permissão Contents → Read and write e as regras do repositório.',
      404: 'O GitHub não encontrou o recurso. Confira se o token tem acesso ao repositório imports.',
      409: 'O repositório mudou durante a publicação. Saia e entre novamente para carregar a versão atual.',
      422: 'O GitHub recusou a publicação. Saia e entre novamente para carregar a versão atual.',
    };
    throw new Error(messages[response.status] || 'Falha na comunicação com o GitHub (' + response.status + ').');
  }
  return response.json();
}

async function loadCatalog() {
  const ref = await github(repository + '/git/ref/heads/main');
  const head = ref.object.sha;
  const [commit, page] = await Promise.all([
    github(repository + '/git/commits/' + head),
    github(repository + '/contents/index.html?ref=' + head),
  ]);
  const bytes = Uint8Array.from(atob(page.content), (character) => character.charCodeAt(0));
  const html = new TextDecoder().decode(bytes);
  const begin = html.indexOf(start);
  const finish = html.indexOf(end);
  if (begin < 0 || finish <= begin || html.lastIndexOf(start) !== begin || html.lastIndexOf(end) !== finish) {
    throw new Error('O catálogo não foi encontrado na versão atual do site.');
  }
  const markup = html.slice(begin + start.length, finish);
  const template = document.createElement('template');
  template.innerHTML = markup;
  const products = [...template.content.querySelectorAll('.prod')].map((card) => ({
    name: card.querySelector('.prod-name').textContent.trim(),
    description: card.querySelector('.prod-desc').textContent.trim(),
    image: card.querySelector('.ph img').getAttribute('src'),
    price: card.querySelector('.prod-price')?.dataset.price || '',
    markup: card.outerHTML,
  }));
  if (products.length === 0) throw new Error('O catálogo está vazio.');
  const contact = html.match(/href="https:\/\/wa\.me\/(\d+)"/);
  if (!contact) throw new Error('O número de WhatsApp da loja não foi encontrado.');
  return { head, tree: commit.tree.sha, html, begin, finish, products, phone: contact[1] };
}

function showPhoto(file) {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = file ? URL.createObjectURL(file) : undefined;
  const current = snapshot?.products[product.value]?.image;
  const source = previewUrl || (/^img\/[\w.-]+$/.test(current || '') ? current : '');
  preview.hidden = !source;
  if (source) preview.src = source;
  else preview.removeAttribute('src');
}

function fillEditor() {
  const current = snapshot.products[product.value];
  byId('name').value = current?.name || '';
  byId('description').value = current?.description || '';
  byId('price').value = current?.price || '';
  photo.value = '';
  photo.required = !current;
  showPhoto();
}

function showProducts(index = 0) {
  const options = snapshot.products.map((item, position) => new Option(item.name, position));
  product.replaceChildren(...options, new Option('Novo produto', 'new'));
  product.value = String(index);
  fillEditor();
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function renderProduct(item, phone) {
  const whatsapp = new URL('https://wa.me/' + phone);
  whatsapp.searchParams.set('text', 'Olá! Tenho interesse no produto: ' + item.name + '.');
  const price = item.price === '' ? '' :
    '\n            <strong class="prod-price" data-price="' + escapeHtml(item.price) + '">' +
    currency.format(Number(item.price)) + '</strong>';
  return `<div class="prod">
          <div class="ph"><img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}"></div>
          <div class="info">
            <h3 class="prod-name">${escapeHtml(item.name)}</h3>
            <p class="prod-desc">${escapeHtml(item.description)}</p>${price}
            <a href="${escapeHtml(whatsapp.href)}" target="_blank" rel="noopener">Tenho interesse</a>
          </div>
        </div>`;
}

async function imageAsBase64(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 15 * 1024 * 1024) {
    throw new Error('Selecione uma imagem JPG, PNG ou WebP de até 15 MB.');
  }
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('A foto selecionada não pôde ser aberta.');
  });
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height));
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const data = canvas.toDataURL('image/webp', 0.86);
  if (!data.startsWith('data:image/webp;base64,')) {
    throw new Error('Este navegador não conseguiu converter a imagem para WebP.');
  }
  return data.split(',')[1];
}

login.addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = byId('token');
  const button = login.querySelector('button');
  token = input.value.trim();
  input.value = '';
  if (!token.startsWith('github_pat_')) {
    token = '';
    status('Informe um token granular do GitHub.');
    return;
  }
  button.disabled = true;
  status('Carregando o catálogo…');
  try {
    const account = await github('/user');
    if (account.login.toLowerCase() !== 'diegosantosss') {
      throw new Error('Use um token da conta proprietária do repositório.');
    }
    snapshot = await loadCatalog();
    showProducts();
    login.hidden = true;
    editor.hidden = false;
    product.focus();
    status('Catálogo carregado.');
  } catch (error) {
    token = '';
    status(error.message);
  } finally {
    button.disabled = false;
  }
});

product.addEventListener('change', fillEditor);
photo.addEventListener('change', () => showPhoto(photo.files[0]));
byId('add').addEventListener('click', () => {
  product.value = 'new';
  fillEditor();
  byId('name').focus();
});
byId('exit').addEventListener('click', () => {
  token = '';
  snapshot = undefined;
  editor.reset();
  product.replaceChildren();
  showPhoto();
  editor.hidden = true;
  login.hidden = false;
  byId('token').focus();
  status('Sessão encerrada.');
});

editor.addEventListener('submit', async (event) => {
  event.preventDefault();
  const fields = byId('fields');
  const index = product.value === 'new' ? snapshot.products.length : Number(product.value);
  const existing = snapshot.products[index];
  const item = {
    name: byId('name').value.trim(),
    description: byId('description').value.trim(),
    price: byId('price').value,
    image: existing?.image,
  };
  const file = photo.files[0];
  if (!item.name || !item.description || (!existing && !file)) {
    status('Preencha o nome, a descrição e a foto do produto.');
    return;
  }

  if (existing && !file && item.name === existing.name &&
      item.description === existing.description && item.price === existing.price) {
    status('Nenhuma alteração para publicar.');
    return;
  }

  fields.disabled = true;
  status('Publicando no GitHub…');
  try {
    const ref = await github(repository + '/git/ref/heads/main');
    if (ref.object.sha !== snapshot.head) {
      throw new Error('O site mudou desde que você entrou. Saia e entre novamente para carregar a versão atual.');
    }

    const entries = [];
    if (file) {
      const content = await imageAsBase64(file);
      const blob = await github(repository + '/git/blobs', 'POST', { content, encoding: 'base64' });
      item.image = 'img/catalogo-' + blob.sha + '.webp';
      entries.push({ path: item.image, mode: '100644', type: 'blob', sha: blob.sha });
    }

    const products = snapshot.products.map((entry) => entry.markup);
    products[index] = renderProduct(item, snapshot.phone);
    const html = snapshot.html.slice(0, snapshot.begin + start.length) +
      '\n        ' + products.join('\n        ') + '\n        ' + snapshot.html.slice(snapshot.finish);
    entries.push({ path: 'index.html', mode: '100644', type: 'blob', content: html });

    const tree = await github(repository + '/git/trees', 'POST', { base_tree: snapshot.tree, tree: entries });
    if (tree.sha === snapshot.tree) {
      status('Nenhuma alteração para publicar.');
      return;
    }

    const commit = await github(repository + '/git/commits', 'POST', {
      message: 'Atualiza catálogo da DS Imports: ' + item.name,
      tree: tree.sha,
      parents: [snapshot.head],
    });
    await github(repository + '/git/refs/heads/main', 'PATCH', { sha: commit.sha, force: false });

    item.markup = products[index];
    snapshot.products[index] = item;
    snapshot = { ...snapshot, head: commit.sha, tree: tree.sha, html, finish: html.indexOf(end) };
    showProducts(index);
    status('Alteração salva no GitHub. Ela ficará visível quando a publicação do site terminar.');
  } catch (error) {
    status(error.message);
  } finally {
    fields.disabled = false;
  }
});
