import { Method } from './models.js';

export const getAllMethods = async () => {
	try {
		//const apps = await Application.findAll({ attributes: ["idapp", "app"] });
		const datas = await Method.findAll();
		return datas;
	} catch (error) {
		console.error('Error retrieving:', error);
		throw error;
	}
};

export const defaultMethods = () => {
	try {
		// console.log(' defaultMethods >>>>>> ');

		let methods = [
			{ id: 'NA', text: `NA` },
			{ id: 'CONNECT', text: `CONNECT` },
			{ id: 'GET', text: `GET` },
			{ id: 'DELETE', text: `DELETE` },
			{ id: 'HEAD', text: `HEAD` },
			{ id: 'PATCH', text: `PATCH` },
			{ id: 'POST', text: `POST` },
			{ id: 'PUT', text: `PUT` },
			{ id: 'QUERY', text: `QUERY` },
			{ id: 'WS', text: `WS` },
			{ id: 'OPTIONS', text: `OPTIONS` }
		];

		methods.forEach(async (m) => {
			try {
				await Method.upsert({
					method: m.id,
					label: m.text
				});
			} catch (error) {
				console.log(error);
			}
		});
		return;
	} catch (error) {
		console.error('Example error:', error);
		return;
	}
};
