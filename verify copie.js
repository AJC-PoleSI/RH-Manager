const http = require('http');

const PORT = 4000;
const BASE_URL = `http://localhost:${PORT}`;

let authToken = '';
const uniqueSuffix = Date.now();

const request = (path, method, body, token) => {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: PORT,
            path: path,
            method: method,
            headers: {
                'Content-Type': 'application/json',
            },
        };

        if (token) {
            options.headers['Authorization'] = `Bearer ${token}`;
        }

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        const json = data ? JSON.parse(data) : {};
                        resolve({ status: res.statusCode, data: json });
                    } else {
                        reject({ status: res.statusCode, body: data });
                    }
                } catch (e) {
                    // If body is empty or not json, just resolve empty
                    resolve({ status: res.statusCode, data: {} });
                }
            });
        });

        req.on('error', (e) => reject(e));
        if (body) {
            req.write(JSON.stringify(body));
        }
        req.end();
    });
};

const runVerification = async () => {
    console.log('Starting Verification...');

    try {
        // 1. Register
        console.log('1. Registering Member...');
        try {
            await request('/auth/register', 'POST', {
                email: `admin${uniqueSuffix}@example.com`,
                password: 'password123',
                isAdmin: true
            });
            console.log('   -> Success');
        } catch (e) {
            console.log('   -> Member process error:', e);
            // Continue but it will likely fail
        }

        // 2. Login
        console.log('2. Logging in...');
        const loginRes = await request('/auth/login', 'POST', {
            email: `admin${uniqueSuffix}@example.com`,
            password: 'password123'
        });
        if (!loginRes.data.token) throw new Error('No token received');
        authToken = loginRes.data.token;
        console.log('   -> Success, Token received');

        // 3. Create Candidate
        console.log('3. Creating Candidate...');
        const candidateRes = await request('/candidates', 'POST', {
            first_name: 'John',
            last_name: 'Doe',
            email: `john${uniqueSuffix}@example.com`,
            phone: '1234567890'
        }, authToken);
        console.log('   -> Success, Candidate ID:', candidateRes.data.id);

        // 4. Create Epreuve
        console.log('4. Creating Epreuve...');
        const epreuveRes = await request('/epreuves', 'POST', {
            name: 'Technical Interview',
            tour: 1,
            type: 'oral',
            duration_minutes: 30,
            evaluation_questions: [{ q: 'Skills', weight: 5 }],
            is_pole_test: false
        }, authToken);
        console.log('   -> Success, Epreuve ID:', epreuveRes.data.id);

        // 5. Add Availability
        console.log('5. Adding Availability...');
        await request('/availability', 'POST', {
            weekday: 'Monday',
            start_time: '09:00',
            end_time: '12:00'
        }, authToken);
        console.log('   -> Success');

        // 6. Generate Planning
        console.log('6. Generating Planning...');
        const planningRes = await request('/planning/generate', 'POST', {
            sessions: 1,
            group_size: 1
        }, authToken);
        console.log('   -> Success, Planning generated');

        // 7. Get KPIs
        console.log('7. Fetching KPIs...');
        const kpiRes = await request('/kpis/global', 'GET', null, authToken);
        console.log('   -> Success');
        console.log(JSON.stringify(kpiRes.data, null, 2));

        console.log('\n✅ VERIFICATION COMPLETE: ALL CHECKS PASSED');
        process.exit(0);

    } catch (error) {
        console.error('\n❌ VERIFICATION FAILED:', error);
        process.exit(1);
    }
};

setTimeout(runVerification, 3000);
