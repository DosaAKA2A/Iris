// HELPERS HELPERS HELPERS
const radians = degrees => {
  return degrees * Math.PI / 180;
};

const distance = (x1, y1, x2, y2) => {
  return Math.sqrt(Math.pow(x1 - x2, 2) + Math.pow(y1 - y2, 2));
};

const map = (value, start1, stop1, start2, stop2) => {
  return (value - start1) / (stop1 - start1) * (stop2 - start2) + start2;
};

const hexToRgbTreeJs = hex => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);

  return result
    ? {
        r: parseInt(result[1], 16) / 255,
        g: parseInt(result[2], 16) / 255,
        b: parseInt(result[3], 16) / 255
      }
    : null;
};

// 🉑 🉑 🉑 🉑 🉑 🉑
class Char {
  constructor(item) {
    this.font = new THREE.FontLoader().parse(font);

    this.geom = new THREE.TextGeometry(item, {
      font: this.font,
      size: 3,
      height: 13,
      curveSegments: 1,
      bevelEnabled: true,
      bevelThickness: 0.2,
      bevelSize: 0.1,
      bevelOffset: -0.1,
      bevelSegments: 5
    });
  }
}

// 👹 👹 👹 👹
class App {
  constructor() {
    this.setup();
    this.createScene();
    this.createGrid();
    this.createCamera();
    this.addFloor();

    // Blue
    this.addBlueLight(0x6eb9ff, { x: 10, y: -5, z: 3 });

    // Rotating
    this.addRotatingLight(0xffffff, { x: 0, y: 0, z: 3 });

    this.animate();

    window.addEventListener("resize", this.onResize.bind(this));
    window.addEventListener("mousemove", this.onMouseMove.bind(this), false);
    this.onMouseMove({ clientX: 0, clientY: 0 });
  }

  setup() {
    this.gutter = { size: 4 };
    this.meshes = [];
    this.grid = { rows: 6, cols: 6 };
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.mouse3D = new THREE.Vector2();
    this.geometries = [
      new Char("私"),
      new Char("ド"),
      new Char("楡"),
      new Char("楫")
    ];

    this.raycaster = new THREE.Raycaster();
  }

  createScene() {
    this.scene = new THREE.Scene();

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);

    this.renderer.shadowMap.enabled = false;

    document.body.appendChild(this.renderer.domElement);
  }

  // 🎥 🎥 🎥 🎥 🎥 🎥
  createCamera() {
    this.camera = new THREE.PerspectiveCamera(
      30,
      window.innerWidth / window.innerHeight,
      1
    );
    this.camera.position.set(15, -8, 40);
    this.camera.lookAt(-5, 0, 0);
    this.scene.add(this.camera);
  }

  // 💡
  addBlueLight(color, position) {
    this.blueLight = new THREE.SpotLight(color, 1, 1000, 1);
    this.blueLight.position.set(position.x, position.y, position.z);

    this.scene.add(this.blueLight);
  }

  // 💡
  addRotatingLight(color, position) {
    this.rotatingLight = new THREE.SpotLight(color, 1, 1000, 1);
    this.rotatingLight.position.set(position.x, position.y, position.z);

    this.scene.add(this.rotatingLight);
  }

  addFloor() {
    const geometry = new THREE.PlaneGeometry(100, 100);
    const material = new THREE.MeshLambertMaterial({
      opacity: 0,
      transparent: true
    });

    this.floor = new THREE.Mesh(geometry, material);

    this.renderer.render(this.scene, this.camera);

    this.scene.add(this.floor);

    const color = 0x000000; // white
    const near = 32;
    const far = 45;
    this.scene.fog = new THREE.Fog(color, near, far);
  }

  getRandomGeometry() {
    return this.geometries[
      Math.floor(Math.random() * Math.floor(this.geometries.length))
    ];
  }

  createGrid() {
    this.groupMesh = new THREE.Object3D();
    
    const meshParams = {
      color: '#ababab',
      metalness: .9,
      emissive: '#ffffff',
      roughness: 0.2,
    };

    const material = new THREE.MeshPhysicalMaterial(meshParams);

    for (let row = 0; row < this.grid.rows; row++) {
      this.meshes[row] = [];

      for (let index = 0; index < 1; index++) {
        for (let col = 0; col < this.grid.cols; col++) {
          const geometry = this.getRandomGeometry();
          const mesh = this.getMesh(geometry.geom, material);

          mesh.position.z = -1;

          mesh.position.x = col + col * this.gutter.size;

          mesh.position.y = row + row * this.gutter.size;

          this.groupMesh.add(mesh);

          this.meshes[row][col] = mesh;
        }
      }
    }

    const centerX = -(this.grid.cols / 2) * this.gutter.size - 1;
    const centerY = -(this.grid.rows / 2) * this.gutter.size - 1;

    this.groupMesh.position.set(centerX, centerY, 0);

    this.scene.add(this.groupMesh);
  }

  getMesh(geometry, material) {
    const mesh = new THREE.Mesh(geometry, material);

    return mesh;
  }

  draw() {
    // this.rotatingLight.position.x = this.mouse3D.x * 20;
    this.rotatingLight.position.x = 20;        
    TweenMax.to(this.rotatingLight.position, 2.5, {y: this.mouse3D.y * 20});
    
    // this.blueLight.position.x = this.mouse3D.x * 20;
    this.blueLight.position.x = -20;
    TweenMax.to(this.blueLight.position, 2.5, {y: this.mouse3D.y * 10});

    // MESHS
    this.raycaster.setFromCamera(this.mouse3D, this.camera);

    const intersects = this.raycaster.intersectObjects([this.floor]);

    if (intersects.length) {
      const { x, y } = intersects[0].point;

      // DRAW ROWS
      for (let row = 0; row < this.grid.rows; row++) {
        for (let col = 0; col < this.grid.cols; col++) {
          const mesh = this.meshes[row][col];

          const mouseDistance = distance(
            x,
            y,
            mesh.position.x + this.groupMesh.position.x + this.gutter.size / 2,
            mesh.position.y + this.groupMesh.position.y + this.gutter.size / 2
          );

          const z = map(mouseDistance /4, 0.3, 0, 0, 1) - 5;
          
          let duration = mouseDistance / 3;
          
          if (duration < .5) {
            duration = .5;
          } else if (duration > 1.5) {
            duration = 1.5;
          }
          
          TweenMax.to(mesh.position, duration, { z });
        }
      }
    }
  }

  onMouseMove({ clientX, clientY }) {
    this.mouse3D.x = clientX / this.width * 2 - 1;
    this.mouse3D.y = -(clientY / this.height) * 2 + 1;
  }

  onResize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;

    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(this.width, this.height);
  }

  animate() {
    this.draw();

    this.renderer.render(this.scene, this.camera);

    requestAnimationFrame(() => this.animate());
  }
}

new App();